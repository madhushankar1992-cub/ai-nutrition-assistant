import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ChatRequestSchema, ChatResponse } from "@/lib/schema";
import { checkRequest, checkResponse, REFUSAL_MESSAGE } from "@/lib/scopeGuard";
import { generateStructuredAnswer, type ConversationTurn } from "@/lib/groq";

// Groq calls can retry with backoff on rate limits/transient errors (lib/groq.ts),
// which can exceed Vercel's default serverless timeout. Hobby plan max is 60s.
export const maxDuration = 60;

async function logFailure(category: string, detail: string) {
  await prisma.failureLogEntry.create({
    data: { category, detail },
  });
}

export async function POST(req: NextRequest) {
  const parsedRequest = ChatRequestSchema.safeParse(await req.json());
  if (!parsedRequest.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { message } = parsedRequest.data;
  let { conversationId } = parsedRequest.data;

  // 1. Load or create conversation + history
  if (!conversationId) {
    const conversation = await prisma.conversation.create({ data: {} });
    conversationId = conversation.id;
  }
  const priorMessages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });

  // 2. Pre-call scope guard — code-level, independent of prompt wording
  const preCheck = checkRequest(
    priorMessages.map((m) => ({ role: m.role, content: m.content })),
    message
  );

  await prisma.message.create({
    data: { conversationId, role: "user", content: message },
  });

  if (!preCheck.allowed) {
    await logFailure(
      "missed_refusal_guard_triggered",
      `Pre-call guard blocked category=${preCheck.category} match="${preCheck.matchedText ?? ""}"`
    );
    const refusal: ChatResponse = { answer: REFUSAL_MESSAGE, claims: [] };
    await prisma.message.create({
      data: { conversationId, role: "assistant", content: refusal.answer },
    });
    return NextResponse.json({ conversationId, ...refusal });
  }

  // 3. Compose prompt: history + new message
  const history: ConversationTurn[] = [
    ...priorMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user", content: message },
  ];

  // 4-5. Call Groq with structured output + schema validation (incl. one retry)
  let result: ChatResponse;
  try {
    result = await generateStructuredAnswer(history);
  } catch (err) {
    await logFailure("invalid_schema", err instanceof Error ? err.message : String(err));
    const fallback: ChatResponse = {
      answer: "Sorry, something went wrong generating a response. Please try again.",
      claims: [],
    };
    await prisma.message.create({
      data: { conversationId, role: "assistant", content: fallback.answer },
    });
    return NextResponse.json({ conversationId, ...fallback }, { status: 422 });
  }

  // 6. Defensively force every source to null in Milestone 1, regardless of
  // what the model returned — a prompt-injection or model slip can't leak a
  // fabricated citation.
  result.claims = result.claims.map((claim) => ({ ...claim, source: null }));

  // 7. Post-call scope guard
  const postCheck = checkResponse(result.answer);
  if (!postCheck.allowed) {
    await logFailure(
      "missed_refusal",
      `Post-call guard caught category=${postCheck.category} in generated answer`
    );
    result = { answer: REFUSAL_MESSAGE, claims: [] };
  }

  // 8. Persist assistant message + claims
  const assistantMessage = await prisma.message.create({
    data: { conversationId, role: "assistant", content: result.answer },
  });
  if (result.claims.length > 0) {
    await prisma.claim.createMany({
      data: result.claims.map((claim) => ({
        messageId: assistantMessage.id,
        text: claim.text,
        source: claim.source,
      })),
    });
  }

  // 9. Respond
  return NextResponse.json({ conversationId, ...result });
}
