import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ChatRequestSchema, type Claim } from "@/lib/schema";
import { checkRequest, checkResponse, REFUSAL_MESSAGE } from "@/lib/scopeGuard";
import { generateGroundedAnswer, type ConversationTurn } from "@/lib/groq";
import { formatPassages, retrieve } from "@/lib/retrieval";
import { bindCitations } from "@/lib/citations";
import { RETRIEVAL_CONFIG_HASH } from "@/lib/retrievalConfig";

// Groq calls retry with backoff on rate limits, and a grounded request also
// embeds the query and hits the vector store first. Hobby plan max is 60s.
export const maxDuration = 60;

async function logFailure(category: string, detail: string) {
  await prisma.failureLogEntry.create({ data: { category, detail } });
}

function notInCorpusMessage(docs: { name: string; publisher: string; year: number }[]): string {
  if (!docs.length) {
    return "I couldn't find anything in the guidance I searched that covers this. I only answer from official public dietary guidance documents.";
  }
  const list = docs.map((d) => `${d.name} (${d.publisher}, ${d.year})`).join("; ");
  return (
    "The guidance I searched doesn't cover that. I looked in: " +
    list +
    ". I only answer from these official documents, so I'd rather say nothing than guess."
  );
}

export async function POST(req: NextRequest) {
  const parsedRequest = ChatRequestSchema.safeParse(await req.json());
  if (!parsedRequest.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { message, documentKey } = parsedRequest.data;
  let { conversationId } = parsedRequest.data;

  // 1. Load or create the conversation. History is keyed by conversationId, so
  // separate chat threads can never see each other's turns.
  if (!conversationId) {
    conversationId = (await prisma.conversation.create({ data: {} })).id;
  }
  const priorMessages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });

  // 2. Scope guard — FIRST, before embedding, retrieval or any model call.
  //
  // Order is part of the specification: a calorie request is refused on policy
  // whether or not the corpus could answer it. Refusing here also means it must
  // never be reported as a not-in-corpus miss, which would mislabel a policy
  // refusal as a coverage gap and corrupt the retrieval metrics.
  const preCheck = checkRequest(
    priorMessages.map((m) => ({ role: m.role, content: m.content })),
    message
  );

  await prisma.message.create({ data: { conversationId, role: "user", content: message } });

  if (!preCheck.allowed) {
    await logFailure(
      "missed_refusal_guard_triggered",
      `Pre-call guard blocked category=${preCheck.category} match="${preCheck.matchedText ?? ""}"`
    );
    await prisma.message.create({
      data: { conversationId, role: "assistant", content: REFUSAL_MESSAGE },
    });
    return NextResponse.json({ conversationId, answer: REFUSAL_MESSAGE, claims: [] });
  }

  // 3. Retrieve. Embedding failure is a HARD failure: there is deliberately no
  // path from "retrieval unavailable" to "answer from model knowledge", because
  // that path returns exactly the ungrounded answers this milestone removes.
  let retrieval;
  try {
    retrieval = await retrieve(message, { documentKey });
  } catch (err) {
    await logFailure("retrieval_failed", err instanceof Error ? err.message : String(err));
    const msg = "I can't reach my reference library right now, so I can't answer from the guidance. Please try again shortly.";
    await prisma.message.create({ data: { conversationId, role: "assistant", content: msg } });
    return NextResponse.json({ conversationId, answer: msg, claims: [] }, { status: 503 });
  }

  // 4. Sufficiency gate — refuse BEFORE the model is asked to write from thin
  // material. Given weak passages a capable model writes a confident wrong
  // answer, which is the quietest way grounding fails.
  if (!retrieval.sufficient) {
    const answer = notInCorpusMessage(retrieval.documentsSearched);
    await logFailure("not_in_corpus", `${retrieval.reason} — query="${message.slice(0, 120)}"`);
    await prisma.message.create({ data: { conversationId, role: "assistant", content: answer } });
    return NextResponse.json({
      conversationId,
      answer,
      claims: [],
      retrieval: {
        mode: documentKey ? "filtered" : "all",
        sufficient: false,
        reason: retrieval.reason,
        k: retrieval.k,
        documentsSearched: retrieval.documentsSearched,
        chunks: [],
        configVersion: RETRIEVAL_CONFIG_HASH,
      },
    });
  }

  // 5. Generate from the retrieved passages only.
  const history: ConversationTurn[] = [
    ...priorMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: message },
  ];

  let llm;
  try {
    llm = await generateGroundedAnswer(history, formatPassages(retrieval.chunks));
  } catch (err) {
    await logFailure("invalid_schema", err instanceof Error ? err.message : String(err));
    const fallback = "Sorry, something went wrong generating a response. Please try again.";
    await prisma.message.create({ data: { conversationId, role: "assistant", content: fallback } });
    return NextResponse.json({ conversationId, answer: fallback, claims: [] }, { status: 422 });
  }

  // 6. Bind citations. A claim whose chunkId was not retrieved for THIS request
  // is dropped — this replaces Milestone 1's blanket `source = null` clamp and
  // is what makes a fabricated citation structurally impossible.
  const { claims: boundClaims, dropped } = bindCitations(llm.claims, retrieval.chunks);
  if (dropped.length) {
    await logFailure(
      "unsupported_claim",
      `${dropped.length} claim(s) dropped — unresolvable chunkId: ` +
        dropped.map((d) => `"${d.text.slice(0, 60)}"`).join(", ")
    );
  }

  let answer = llm.answer;
  let claims: Claim[] = boundClaims;

  // 7. Post-call scope guard — independent of whether the pre-call check passed.
  const postCheck = checkResponse(answer);
  if (!postCheck.allowed) {
    await logFailure("missed_refusal", `Post-call guard caught category=${postCheck.category}`);
    answer = REFUSAL_MESSAGE;
    claims = [];
  }

  // 8. Persist.
  const assistantMessage = await prisma.message.create({
    data: { conversationId, role: "assistant", content: answer },
  });
  if (claims.length > 0) {
    await prisma.claim.createMany({
      data: claims.map((c) => ({
        messageId: assistantMessage.id,
        text: c.text,
        source: c.source ? JSON.stringify(c.source) : null,
        chunkId: c.source?.chunkId ?? null,
      })),
    });
  }

  // 9. Respond. The envelope is unchanged from Milestone 1; `retrieval` is added
  // alongside, so a Milestone 1 client keeps working and simply ignores it.
  return NextResponse.json({
    conversationId,
    answer,
    claims,
    retrieval: {
      mode: documentKey ? "filtered" : "all",
      sufficient: true,
      reason: retrieval.reason,
      k: retrieval.k,
      documentsSearched: retrieval.documentsSearched,
      chunks: retrieval.chunks.map((c) => ({
        id: c.id,
        documentName: c.documentName,
        publisher: c.publisher,
        year: c.year,
        section: c.section,
        page: c.page,
        text: c.text,
        score: Number(c.score.toFixed(4)),
        vectorScore: Number(c.vectorScore.toFixed(4)),
        lexicalScore: Number(c.lexicalScore.toFixed(4)),
      })),
      configVersion: RETRIEVAL_CONFIG_HASH,
    },
  });
}

/**
 * Deletes a single conversation and its messages/claims.
 * DELETE /api/chat?conversationId=<id>
 *
 * Never touches Document or Chunk: those are corpus data, not user data.
 */
export async function DELETE(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }

  const messages = await prisma.message.findMany({
    where: { conversationId },
    select: { id: true },
  });
  const messageIds = messages.map((m) => m.id);

  await prisma.claim.deleteMany({ where: { messageId: { in: messageIds } } });
  await prisma.message.deleteMany({ where: { conversationId } });
  await prisma.conversation.deleteMany({ where: { id: conversationId } });

  return NextResponse.json({ deleted: true, conversationId });
}
