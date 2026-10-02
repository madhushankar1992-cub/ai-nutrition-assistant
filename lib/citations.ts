// Citation binding — the most important code in the retrieval path.
//
// Milestone 1 guaranteed no fabricated citations crudely but absolutely: force
// `source = null` on every claim, whatever the model returned. Removing that
// clamp means replacing it with something equally mechanical.
//
// The guarantee here, by construction rather than by prompt compliance:
//
//   - A citation can only name a chunk retrieved FOR THIS REQUEST. Not merely
//     a chunk that exists somewhere — one in this request's result set.
//   - Publisher, year and URL are read from the database row. The model never
//     emits them, so it cannot misattribute them.
//   - A claim the model could not attribute is DROPPED, satisfying "no citation
//     means the claim doesn't ship" in code rather than in prose.
//
// What this does NOT guarantee: that the claim is actually supported by the
// passage it cites. A model can cite passage 3 and slightly misstate it. No
// code can detect that, which is exactly why a manual spot-check of 10 answers
// is a required deliverable.

import type { Citation } from "./schema";
import type { ScoredChunk } from "./retrieval";

export interface LlmClaim {
  text: string;
  chunkId: string;
}

export interface BoundClaim {
  text: string;
  source: Citation;
}

export interface BindResult {
  claims: BoundClaim[];
  dropped: { text: string; chunkId: string; reason: string }[];
}

export function bindCitations(llmClaims: LlmClaim[], retrieved: ScoredChunk[]): BindResult {
  const byId = new Map(retrieved.map((c) => [c.id, c]));
  const claims: BoundClaim[] = [];
  const dropped: BindResult["dropped"] = [];

  for (const claim of llmClaims) {
    const text = (claim.text ?? "").trim();
    if (!text) continue;

    const chunk = byId.get(claim.chunkId);
    if (!chunk) {
      // Either a hallucinated id, or a real chunk that was not retrieved for
      // this question. Both are unsupported here.
      dropped.push({
        text,
        chunkId: claim.chunkId ?? "(none)",
        reason: "chunkId was not in this request's retrieval set",
      });
      continue;
    }

    claims.push({
      text,
      source: {
        document: chunk.documentName, // from the database, never the model
        publisher: chunk.publisher,
        year: chunk.year,
        url: chunk.url,
        section: chunk.section ?? null,
        page: chunk.page ?? null,
        chunkId: chunk.id,
      },
    });
  }

  return { claims, dropped };
}

/**
 * Group claims by document for display.
 *
 * Cross-document answers must read as per-document positions rather than one
 * blended consensus, so the UI needs them grouped rather than flat.
 */
export function groupByDocument(claims: BoundClaim[]): {
  document: string;
  publisher: string;
  year: number;
  url: string;
  claims: BoundClaim[];
}[] {
  const groups = new Map<string, ReturnType<typeof groupByDocument>[number]>();
  for (const c of claims) {
    const key = `${c.source.document}|${c.source.year}`;
    if (!groups.has(key)) {
      groups.set(key, {
        document: c.source.document,
        publisher: c.source.publisher,
        year: c.source.year,
        url: c.source.url,
        claims: [],
      });
    }
    groups.get(key)!.claims.push(c);
  }
  return [...groups.values()];
}
