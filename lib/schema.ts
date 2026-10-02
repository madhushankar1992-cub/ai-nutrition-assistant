import { z } from "zod";

// A citation is an object, not a URL string.
//
// The original Milestone 1 note planned to widen `source` to
// z.string().url().nullable(). That is insufficient: the requirement is that
// every claim shows document name, publisher, year AND a link, and a URL
// carries only the link. The field name and the response envelope are still
// unchanged, which is what was actually frozen.
export const CitationSchema = z.object({
  document: z.string().min(1),
  publisher: z.string().min(1),
  year: z.number().int(),
  url: z.string().url(),
  section: z.string().nullable(),
  page: z.number().int().nullable(),
  chunkId: z.string().min(1),
});

export type Citation = z.infer<typeof CitationSchema>;

// What the API returns. `source` is null only on refusal paths, which carry no
// claims at all.
export const ClaimSchema = z.object({
  text: z.string().min(1),
  source: CitationSchema.nullable(),
});

export const ChatResponseSchema = z.object({
  answer: z.string().min(1),
  claims: z.array(ClaimSchema),
});

// What the MODEL is allowed to emit.
//
// Deliberately narrower than ClaimSchema: the model can point at a passage it
// was given, and nothing more. If it could emit `publisher` or `year` it could
// emit them wrongly — a fabricated citation that still passes validation. The
// server builds the citation from the database row instead.
export const LlmClaimSchema = z.object({
  text: z.string().min(1),
  chunkId: z.string().min(1),
});

export const LlmResponseSchema = z.object({
  answer: z.string().min(1),
  claims: z.array(LlmClaimSchema),
});

export type LlmResponse = z.infer<typeof LlmResponseSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

// Milestone 1 shape, kept so the before/after evaluation can still run against
// the ungrounded prompt.
export const M1ClaimSchema = z.object({
  text: z.string().min(1),
  source: z.null(),
});
export const M1ResponseSchema = z.object({
  answer: z.string().min(1),
  claims: z.array(M1ClaimSchema),
});

export const ChatRequestSchema = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  message: z.string().min(1),
  /** Restrict retrieval to one named document. */
  documentKey: z.string().min(1).nullable().optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
