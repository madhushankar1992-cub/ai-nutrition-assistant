-- Drop Chunk.restricted.
--
-- The column was computed at ingestion and stored on every chunk, but nothing
-- ever read it: retrieval filtered only on `kind`, and the route never consulted
-- it. It was a safety signal the design intended and the code never applied, so
-- it read as protection that did not exist.
--
-- Restricted-content policy is enforced where it actually runs: lib/scopeGuard.ts
-- before retrieval and again on the generated answer. The phrasing hole this
-- column might have covered ("protein relative to body mass") is now matched
-- there instead.

ALTER TABLE "Chunk" DROP COLUMN IF EXISTS restricted;
