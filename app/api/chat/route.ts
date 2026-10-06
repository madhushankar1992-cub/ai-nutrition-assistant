import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ChatRequestSchema, type AnswerMode, type Claim } from "@/lib/schema";
import { checkRequest, checkResponse, REFUSAL_MESSAGE } from "@/lib/scopeGuard";
import { generateGeneralAnswer, generateGroundedAnswer, type ConversationTurn } from "@/lib/groq";
import { OFF_TOPIC_MESSAGE } from "@/lib/systemPrompt";
import { formatPassages, retrieve } from "@/lib/retrieval";
import { bindCitations } from "@/lib/citations";
import { RETRIEVAL_CONFIG_HASH } from "@/lib/retrievalConfig";
import { storeStats } from "@/lib/corpus/vectorStore";
import { resolveOwner, type OwnerResult } from "@/lib/session";
import { getSource } from "@/lib/corpus/sources";

// Groq calls retry with backoff on rate limits, and a grounded request also
// embeds the query and hits the vector store first. Hobby plan max is 60s.
export const maxDuration = 60;

// Retrieval embeds the query locally with bge-small (ONNX, ~130 MB of weights),
// which loads in a long-running container but NOT in a serverless function.
// Where BACKEND_API_URL is set — i.e. on the Vercel frontend — this route
// forwards to the container instead of trying to run retrieval itself.
//
// A next.config rewrite does not work for this: Next gives filesystem routes
// precedence over rewrites, so this handler would still win. Forwarding has to
// happen inside the handler. Doing it server-side also keeps the browser
// talking to one origin, so there is no CORS to configure.
const BACKEND_API_URL = process.env.BACKEND_API_URL?.replace(/\/$/, "");

async function proxyToBackend(req: NextRequest, body?: string): Promise<NextResponse> {
  const target = `${BACKEND_API_URL}/api/chat${req.nextUrl.search}`;
  const cookie = req.headers.get("cookie");

  const upstream = await fetch(target, {
    method: req.method,
    // The owner cookie has to survive the hop in both directions, or the
    // backend mints a new owner on every request and no conversation is ever
    // readable twice.
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body,
  });

  const text = await upstream.text();
  const headers = new Headers({ "Content-Type": "application/json" });
  const setCookie = upstream.headers.get("set-cookie");
  if (setCookie) headers.set("set-cookie", setCookie);

  return new NextResponse(text, { status: upstream.status, headers });
}

/** Attach Set-Cookie when a new owner id was minted for this request. */
function withOwnerCookie(res: NextResponse, owner: OwnerResult): NextResponse {
  if (owner.setCookie) res.headers.set("set-cookie", owner.setCookie);
  return res;
}

async function logFailure(category: string, detail: string) {
  // Never throw from inside an error path. The commonest cause of a retrieval
  // failure is the database being unreachable - and pgvector lives in that same
  // database, so an unguarded write here throws inside the catch block that was
  // supposed to return a clean 503, turning it into an opaque 500.
  try {
    await prisma.failureLogEntry.create({ data: { category, detail } });
  } catch {
    // Logging is best-effort; losing a log row must not change the response.
  }
}

/**
 * True when the model gave the off-topic refusal. Both tiers' prompts tell the
 * model to reply with exactly OFF_TOPIC_MESSAGE; matching its distinctive
 * opening sentence (whitespace-normalised) also catches a reply that wraps the
 * message in extra words, which is then replaced with the exact message.
 */
function isOffTopicReply(answer: string): boolean {
  const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
  return norm(answer).includes(norm(OFF_TOPIC_MESSAGE.split(". ")[0]));
}

/**
 * Turns a generation failure (either tier) into an honest response: running
 * out of Groq capacity is a 503 the client can retry, anything else a 422.
 */
async function generationFailure(
  err: unknown,
  conversationId: string,
  owner: OwnerResult
): Promise<NextResponse> {
  // Two different failures used to share one label and one message. Running
  // out of Groq capacity - the per-minute token budget is spent, so a queued
  // request outlives the generation deadline, or the daily quota is gone - is
  // not a malformed response, and telling the user "something went wrong" for
  // it is untrue. It is reported as capacity, with a 503 the client can retry,
  // and logged under its own category so the failure log can tell a quota
  // problem from a model problem.
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";
  const status = (err as { status?: number } | null)?.status;
  const atCapacity =
    name === "AbortError" ||
    name === "TimeoutError" ||
    status === 429 ||
    // The local limiter's own refusals, e.g. "exceeds the per-minute budget".
    /rate limit|per-minute budget/i.test(message);

  await logFailure(atCapacity ? "capacity" : "invalid_schema", message);
  const fallback = atCapacity
    ? "The assistant is at capacity right now. Please try again in a minute."
    : "Sorry, something went wrong generating a response. Please try again.";
  await prisma.message.create({ data: { conversationId, role: "assistant", content: fallback } });
  return withOwnerCookie(
    NextResponse.json(
      { conversationId, answer: fallback, claims: [] },
      { status: atCapacity ? 503 : 422, headers: atCapacity ? { "Retry-After": "60" } : undefined }
    ),
    owner
  );
}

// The model sometimes copies tool-style citation markers ("【PASSAGE 1†L3】")
// into its text. Citations are built server-side from the database, so the
// markers are noise the user should never see.
const stripMarkers = (text: string) => text.replace(/[ \t]*【[^】]*】/g, "").trim();

function notInCorpusMessage(docs: { name: string; publisher: string; year: number }[]): string {
  if (!docs.length) {
    return "I couldn't find anything in the guidance I searched that covers this. I only answer from official public dietary guidance documents.";
  }
  const list = docs.map((d) => `${d.name} (${d.publisher}, ${d.year})`).join("; ");
  // Since the general tier (2026-10-06) this is only reached when the user
  // restricted the search to one document (documentKey) and it does not cover
  // the question. An off-topic question asked that way lands here too, so the
  // wording states the assistant's scope as well as the coverage gap.
  return (
    "I only answer questions about food, nutrition and food safety, from official public guidance. " +
    "The guidance I searched doesn't cover that. I looked in: " +
    list +
    ". I'd rather say nothing than guess."
  );
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (BACKEND_API_URL) return proxyToBackend(req, raw);

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsedRequest = ChatRequestSchema.safeParse(payload);
  if (!parsedRequest.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { message, documentKey } = parsedRequest.data;

  // An unknown or disabled document key used to pass validation, run an
  // embedding and a search, and answer 200 "couldn't find anything" - a
  // client typo reported as a coverage gap. It is a bad request.
  if (documentKey && !getSource(documentKey)?.enabled) {
    return NextResponse.json({ error: "Unknown documentKey" }, { status: 400 });
  }
  let { conversationId } = parsedRequest.data;

  // 1. Establish who is asking, then load or create the conversation. History
  // is keyed by conversationId, so separate chat threads can never see each
  // other's turns — and ownership means another browser cannot read this one
  // by presenting its id.
  const owner = resolveOwner(req.headers.get("cookie"));

  if (!conversationId) {
    conversationId = (await prisma.conversation.create({ data: { ownerId: owner.ownerId } })).id;
  } else {
    const existing = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, ownerId: true },
    });

    if (!existing) {
      // An unknown id is treated as a new conversation rather than an error:
      // the client may be holding an id from a cleared database.
      conversationId = (await prisma.conversation.create({ data: { ownerId: owner.ownerId } })).id;
    } else if (existing.ownerId === null) {
      // Predates ownership — claimed by the first browser to open it.
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { ownerId: owner.ownerId },
      });
    } else if (existing.ownerId !== owner.ownerId) {
      return withOwnerCookie(
        NextResponse.json({ error: "Not found" }, { status: 404 }),
        owner
      );
    }
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
    return withOwnerCookie(
      NextResponse.json({
        conversationId,
        answer: REFUSAL_MESSAGE,
        claims: [],
        answerMode: "refused" satisfies AnswerMode,
      }),
      owner
    );
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
    return withOwnerCookie(
      NextResponse.json({ conversationId, answer: msg, claims: [] }, { status: 503 }),
      owner
    );
  }

  const history: ConversationTurn[] = [
    ...priorMessages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    { role: "user", content: message },
  ];

  // 4. Sufficiency gate. The model is never asked to write a GROUNDED answer
  // from thin material: given weak passages a capable model writes a confident
  // wrong answer behind real-looking citations, which is the quietest way
  // grounding fails.
  //
  // What happens instead depends on the request:
  //   - documentKey set: the user asked about ONE document, and it does not
  //     cover this. Answering from general knowledge would misrepresent what
  //     that document says, so the not-in-corpus reply stands.
  //   - otherwise: the general-knowledge tier (added 2026-10-06) answers from
  //     model knowledge, with NO claims and answerMode "general", so the client
  //     labels it as not coming from the cited documents.
  if (!retrieval.sufficient) {
    await logFailure("not_in_corpus", `${retrieval.reason} — query="${message.slice(0, 120)}"`);
    const retrievalBlock = {
      mode: documentKey ? "filtered" : "all",
      sufficient: false,
      reason: retrieval.reason,
      k: retrieval.k,
      documentsSearched: retrieval.documentsSearched,
      chunks: [],
      configVersion: RETRIEVAL_CONFIG_HASH,
    };

    if (documentKey) {
      const answer = notInCorpusMessage(retrieval.documentsSearched);
      await prisma.message.create({ data: { conversationId, role: "assistant", content: answer } });
      return withOwnerCookie(
        NextResponse.json({
          conversationId,
          answer,
          claims: [],
          answerMode: "refused" satisfies AnswerMode,
          retrieval: retrievalBlock,
        }),
        owner
      );
    }

    // 4b. General tier. One extra Groq call, only on this path; the rate
    // limiter and the generation deadline apply to it like any other call.
    let general;
    try {
      general = await generateGeneralAnswer(history);
    } catch (err) {
      return generationFailure(err, conversationId, owner);
    }

    let generalAnswer = stripMarkers(general.answer);
    if (!generalAnswer) {
      await logFailure("invalid_schema", "Model returned a blank general answer");
      const fallback = "Sorry, something went wrong generating a response. Please try again.";
      await prisma.message.create({ data: { conversationId, role: "assistant", content: fallback } });
      return withOwnerCookie(
        NextResponse.json({ conversationId, answer: fallback, claims: [] }, { status: 422 }),
        owner
      );
    }

    let generalMode: AnswerMode = "general";
    // Off-topic is refused, never answered and never labelled "general".
    if (isOffTopicReply(generalAnswer)) {
      generalAnswer = OFF_TOPIC_MESSAGE;
      generalMode = "refused";
    }

    // Post-call scope guard: applies to general answers exactly as to grounded.
    const generalCheck = checkResponse(generalAnswer);
    if (!generalCheck.allowed) {
      await logFailure(
        "missed_refusal",
        `Post-call guard caught category=${generalCheck.category} (general tier)`
      );
      generalAnswer = REFUSAL_MESSAGE;
      generalMode = "refused";
    }

    await prisma.message.create({
      data: { conversationId, role: "assistant", content: generalAnswer },
    });
    // claims is ALWAYS empty here: there are no retrieved passages a claim
    // could be bound to, so any citation would be fabricated.
    return withOwnerCookie(
      NextResponse.json({
        conversationId,
        answer: generalAnswer,
        claims: [],
        answerMode: generalMode,
        retrieval: retrievalBlock,
      }),
      owner
    );
  }

  // 5. Generate from the retrieved passages only (grounded tier).

  let llm;
  try {
    llm = await generateGroundedAnswer(history, formatPassages(retrieval.chunks));
  } catch (err) {
    return generationFailure(err, conversationId, owner);
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

  let answer = stripMarkers(llm.answer);
  // A claim that was nothing but a marker is dropped rather than shipped empty.
  let claims: Claim[] = boundClaims
    .map((c) => ({ ...c, text: stripMarkers(c.text) }))
    .filter((c) => c.text.length > 0);

  // A blank answer passed the schema (it only checks length >= 1) and was
  // returned as a 200 with an empty bubble. It is a failed generation.
  if (!answer) {
    await logFailure("invalid_schema", "Model returned a blank answer");
    const fallback = "Sorry, something went wrong generating a response. Please try again.";
    await prisma.message.create({ data: { conversationId, role: "assistant", content: fallback } });
    return withOwnerCookie(
      NextResponse.json({ conversationId, answer: fallback, claims: [] }, { status: 422 }),
      owner
    );
  }
  let suppressed = false;
  let answerMode: AnswerMode = "grounded";

  // The grounded prompt also tells the model to give the off-topic message, for
  // an off-topic question that happens to retrieve well. It is a refusal.
  if (isOffTopicReply(answer)) {
    answer = OFF_TOPIC_MESSAGE;
    claims = [];
    answerMode = "refused";
    // Nothing was answered, so no passages are shipped alongside the refusal.
    suppressed = true;
  }

  // 7. Post-call scope guard — independent of whether the pre-call check passed.
  const postCheck = checkResponse(answer);
  if (!postCheck.allowed) {
    await logFailure("missed_refusal", `Post-call guard caught category=${postCheck.category}`);
    answer = REFUSAL_MESSAGE;
    claims = [];
    // The passages are withheld too. Replacing only the answer while still
    // returning retrieval.chunks[].text ships the exact numeric or medical
    // content the guard just decided must not go out, to any client that reads
    // the retrieval block.
    suppressed = true;
    answerMode = "refused";
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

  // 9. Respond. The envelope is unchanged from Milestone 1; `retrieval` and
  // `answerMode` are added alongside, so an older client keeps working and
  // simply ignores them.
  return withOwnerCookie(
    NextResponse.json({
    conversationId,
    answer,
    claims,
    answerMode,
    retrieval: {
      mode: documentKey ? "filtered" : "all",
      sufficient: true,
      reason: retrieval.reason,
      k: retrieval.k,
      documentsSearched: retrieval.documentsSearched,
      chunks: (suppressed ? [] : retrieval.chunks).map((c) => ({
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
  }),
    owner
  );
}

/**
 * GET /api/chat — service status.
 *
 * The chat endpoint answers POST, so opening it in a browser used to return a
 * bare 405 that reads as an outage ("This page isn't working right now"). It is
 * the URL anyone checking the backend tries first, so it answers with what they
 * are actually asking: whether the API, the database and the corpus are up.
 *
 * Deliberately exposes no secrets and no conversation data — only whether the
 * key is configured, never any part of its value.
 */
export async function GET(req: NextRequest) {
  if (BACKEND_API_URL) return proxyToBackend(req);

  const body: Record<string, unknown> = {
    service: "ai-nutrition-assistant",
    endpoint: "/api/chat",
    usage: "POST { message: string, conversationId?: string, documentKey?: string }",
    retrievalConfig: RETRIEVAL_CONFIG_HASH,
    groqConfigured: Boolean(process.env.GROQ_API_KEY),
  };

  // A corpus count is the one check that proves the whole retrieval path is
  // live: extension, embedding column and index all have to exist to answer it.
  try {
    const stats = await storeStats();
    return NextResponse.json({ ...body, status: "ok", corpus: stats });
  } catch (err) {
    return NextResponse.json(
      {
        ...body,
        status: "degraded",
        corpus: null,
        // Deliberately not err.message: Prisma names the host, port and user in
        // P1000/P1001, which would turn an unauthenticated status endpoint into
        // infrastructure disclosure during an incident.
        detail: "corpus unavailable",
      },
      { status: 503 }
    );
  }
}

/**
 * Deletes a single conversation and its messages/claims.
 * DELETE /api/chat?conversationId=<id>
 *
 * Never touches Document or Chunk: those are corpus data, not user data.
 */
export async function DELETE(req: NextRequest) {
  if (BACKEND_API_URL) return proxyToBackend(req);

  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (!conversationId) {
    return NextResponse.json({ error: "conversationId is required" }, { status: 400 });
  }

  // Deleting someone else's conversation must not be possible either. A
  // mismatch answers 404 rather than 403, so the endpoint does not confirm
  // that an id exists to anyone who is not its owner.
  const owner = resolveOwner(req.headers.get("cookie"));
  const existing = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { ownerId: true },
  });
  if (!existing || (existing.ownerId !== null && existing.ownerId !== owner.ownerId)) {
    return withOwnerCookie(NextResponse.json({ error: "Not found" }, { status: 404 }), owner);
  }

  const messages = await prisma.message.findMany({
    where: { conversationId },
    select: { id: true },
  });
  const messageIds = messages.map((m) => m.id);

  await prisma.claim.deleteMany({ where: { messageId: { in: messageIds } } });
  await prisma.message.deleteMany({ where: { conversationId } });
  await prisma.conversation.deleteMany({ where: { id: conversationId } });

  return withOwnerCookie(NextResponse.json({ deleted: true, conversationId }), owner);
}
