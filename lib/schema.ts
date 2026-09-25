import { z } from "zod";

// Milestone 1: source is always null. Milestone 2 will widen this to
// z.string().url().nullable() — the field and shape never change, only
// the type of value it can hold.
export const ClaimSchema = z.object({
  text: z.string().min(1),
  source: z.null(),
});

export const ChatResponseSchema = z.object({
  answer: z.string().min(1),
  claims: z.array(ClaimSchema),
});

export type Claim = z.infer<typeof ClaimSchema>;
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

export const ChatRequestSchema = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  message: z.string().min(1),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
