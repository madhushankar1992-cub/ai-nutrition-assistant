-- Conversation ownership.
--
-- `conversationId` was accepted from the client without any check, so anyone
-- holding a UUID could read and extend that conversation. This adds the owner
-- column that lib/session.ts checks against a signed, httpOnly cookie.
--
-- Nullable on purpose: conversations that predate ownership have no owner, and
-- are claimed by the first browser to open them. The alternative — backfilling
-- a random owner — would lock every existing conversation out of its own
-- browser, deleting history to close a prototype-level gap.

ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "ownerId" TEXT;

CREATE INDEX IF NOT EXISTS "Conversation_ownerId_idx" ON "Conversation" ("ownerId");
