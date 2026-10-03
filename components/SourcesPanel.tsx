"use client";

import type { ChatMessage } from "./MessageBubble";
import { SourcesIcon } from "./icons";

// The Milestone 1 version of this branch rendered `claim.source` as both the
// href and the visible link text, which only works for a bare URL string. A
// citation is now an object carrying document, publisher, year, section and
// page, so the branch is rewritten rather than merely switched on.
//
// Claims are grouped BY DOCUMENT. When two publishers address the same question
// the answer must read as two attributed positions, not one blended consensus —
// a flat list of cards makes disagreement look like agreement.
//
// Two things beyond that grouping are requirements rather than decoration:
//
//   1. THE CITED PASSAGE IS SHOWN. A reference the reader cannot open is not a
//      citation, it is a claim about a citation. Each claim carries the
//      `chunkId` the server bound it to, and the response carries the passages
//      retrieved for that turn, so the exact text the claim was drawn from is
//      rendered under it — collapsed by default, because five open passages
//      bury the answer they support.
//   2. THE TWO REFUSAL TYPES LOOK DIFFERENT. "I will not answer this" and "the
//      documents I searched do not cover this" are different events with
//      different remedies: one is policy and will never change, the other is a
//      corpus gap that ingesting a document would close. Collapsing them into
//      one grey sentence tells the reader neither.

/** One passage retrieved for the turn — `retrieval.chunks[]` from the API. */
export interface RetrievedPassage {
  id: string;
  documentName: string;
  publisher: string;
  year: number;
  section: string | null;
  page: number | null;
  text: string;
  score: number;
}

export interface RetrievalInfo {
  sufficient: boolean;
  reason?: string;
  documentsSearched?: { name: string; publisher: string; year: number }[];
  /**
   * Only the passages the shipped claims actually cite. The full top-k is not
   * kept: these messages are persisted to localStorage, and five passages per
   * turn across twenty threads overflows the quota, at which point nothing is
   * saved at all.
   */
  passages?: RetrievedPassage[];
}

/**
 * Why a turn carries no claims.
 *
 *   policy   — the scope guard refused: calorie/macro targets, personal weight
 *              advice, condition-specific medical guidance. Nothing was
 *              searched, and no corpus change would alter the outcome.
 *   coverage — the sufficiency gate refused: the corpus was searched and does
 *              not cover the question.
 *   error    — the request failed (retrieval or generation), which is neither.
 */
export type RefusalKind = "policy" | "coverage" | "error";

export interface SourcedMessage extends ChatMessage {
  retrieval?: RetrievalInfo | null;
  refusal?: RefusalKind | null;
}

function RefusalNotice({ message }: { message: SourcedMessage }) {
  const kind = message.refusal;
  const searched = message.retrieval?.documentsSearched ?? [];

  if (kind === "policy") {
    return (
      <div className="rounded-2xl border border-amber-400/35 bg-amber-400/[0.07] p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-amber-300/60 text-[11px] font-bold text-amber-300">
            !
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-300">
            Out of scope · refused on policy
          </span>
        </div>
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-muted">
          This reply was withheld by the scope checks. Calorie and macro targets,
          personal weight recommendations and condition-specific medical advice are outside
          what this assistant will answer, however the question is phrased.
        </p>
        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
          No source passages are shown for this refusal. Adding guidance to the
          library would not change this answer — please speak to a qualified professional.
        </p>
      </div>
    );
  }

  if (kind === "coverage") {
    return (
      <div className="rounded-2xl border border-sky-400/30 bg-sky-400/[0.06] p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-sky-300/55 text-[11px] font-bold text-sky-300">
            ?
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">
            Not covered · nothing found to cite
          </span>
        </div>
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-muted">
          The question is in scope, but none of the guidance searched answers it closely
          enough to quote. Nothing was written from general knowledge instead.
        </p>
        {searched.length > 0 && (
          <>
            <p className="mt-3 text-[10.5px] font-semibold uppercase tracking-wider text-ink-faint">
              Documents searched
            </p>
            <ul className="mt-1.5 space-y-1">
              {searched.map((d, i) => (
                <li key={i} className="text-[11.5px] leading-snug text-ink-muted">
                  {d.name}
                  <span className="text-ink-faint">
                    {" "}
                    — {d.publisher} {d.year}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

  if (kind === "error") {
    return (
      <div className="rounded-2xl border border-red-400/30 bg-red-400/[0.06] p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-red-300/55 text-[11px] font-bold text-red-300">
            ×
          </span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-red-300">
            Request failed
          </span>
        </div>
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-muted">
          The reference library or the model could not be reached, so this turn has no
          sources. This is a fault, not a refusal — try the question again.
        </p>
      </div>
    );
  }

  // In scope, searched, answered — but the answer carried no decomposed claims.
  return (
    <p className="text-sm text-ink-faint">
      This reply carries no individual claims, so there is nothing to attribute.
    </p>
  );
}

function PassageDisclosure({ passage }: { passage: RetrievedPassage }) {
  return (
    <details className="group mt-2.5">
      <summary className="cursor-pointer list-none text-[11px] font-medium text-ink-faint transition hover:text-accent [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">Show cited passage ▸</span>
        <span className="hidden group-open:inline">Hide cited passage ▾</span>
      </summary>
      <blockquote className="mt-2 max-h-[220px] overflow-y-auto thin-scrollbar rounded-xl border-l-2 border-accent/40 bg-black/25 px-3 py-2.5 text-[11.5px] leading-relaxed text-ink-muted">
        {passage.text}
      </blockquote>
      <p className="mt-1.5 text-[10.5px] text-ink-faint">
        {passage.documentName}
        {passage.section ? ` · ${passage.section}` : ""}
        {passage.page ? ` · p.${passage.page}` : ""} · match {passage.score.toFixed(2)}
      </p>
    </details>
  );
}

export function SourcesPanel({ selectedMessage }: { selectedMessage: SourcedMessage | null }) {
  const claims = selectedMessage?.claims ?? [];

  // chunkId -> passage, so each claim can show the text it was drawn from.
  const passagesById = new Map<string, RetrievedPassage>(
    (selectedMessage?.retrieval?.passages ?? []).map((p) => [p.id, p])
  );

  const groups = new Map<
    string,
    { document: string; publisher: string; year: number; url: string; items: typeof claims }
  >();
  for (const claim of claims) {
    const src = claim.source;
    const key = src ? `${src.document}|${src.year}` : "__uncited__";
    if (!groups.has(key)) {
      groups.set(key, {
        document: src?.document ?? "Uncited",
        publisher: src?.publisher ?? "",
        year: src?.year ?? 0,
        url: src?.url ?? "",
        items: [],
      });
    }
    groups.get(key)!.items.push(claim);
  }
  const grouped = [...groups.values()];

  return (
    <aside className="hidden w-[340px] shrink-0 flex-col border-l border-white/10 bg-surface-dim md:flex">
      <div className="border-b border-white/10 px-6 py-5">
        <h2 className="font-display text-lg font-semibold text-ink">Sources</h2>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          {grouped.length > 1
            ? `${claims.length} claims across ${grouped.length} documents`
            : "Guidance behind the selected reply"}
        </p>
      </div>

      <div className="thin-scrollbar flex-1 overflow-y-auto px-5 py-5">
        {!selectedMessage && (
          <p className="text-sm text-ink-faint">
            Select an assistant reply to see the guidance it was drawn from.
          </p>
        )}

        {selectedMessage && claims.length === 0 && (
          <RefusalNotice message={selectedMessage} />
        )}

        <div className="space-y-5">
          {grouped.map((group, gi) => (
            <div key={gi}>
              <div className="mb-2.5 flex items-baseline justify-between gap-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-wider text-accent">
                  {group.publisher || "Source"}
                </span>
                {group.year > 0 && (
                  <span className="shrink-0 text-[11px] text-ink-faint">{group.year}</span>
                )}
              </div>

              {group.url ? (
                <a
                  href={group.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mb-2.5 flex items-start gap-1.5 text-[12.5px] leading-snug text-ink-muted underline decoration-white/20 hover:text-accent hover:decoration-accent"
                >
                  <SourcesIcon className="mt-[3px] h-3 w-3 shrink-0" />
                  <span className="min-w-0">{group.document}</span>
                </a>
              ) : (
                <p className="mb-2.5 text-[12.5px] text-ink-muted">{group.document}</p>
              )}

              <ul className="space-y-2.5">
                {group.items.map((claim, i) => {
                  const passage = claim.source ? passagesById.get(claim.source.chunkId) : undefined;
                  return (
                    <li
                      key={i}
                      className="rounded-2xl border border-accent/25 bg-accent/[0.06] p-3.5"
                    >
                      <p className="text-[13.5px] leading-snug text-ink">{claim.text}</p>
                      {claim.source && (
                        <p className="mt-2 text-[11px] text-ink-faint">
                          {claim.source.section ? claim.source.section : "—"}
                          {claim.source.page ? ` · p.${claim.source.page}` : ""}
                        </p>
                      )}
                      {passage ? (
                        <PassageDisclosure passage={passage} />
                      ) : (
                        // Threads restored from a browser session that predates
                        // passage capture keep their citations but not the text.
                        <p className="mt-2 text-[10.5px] text-ink-faint">
                          Passage text not stored for this reply — open the document link above.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {grouped.length > 1 && (
          <p className="mt-5 border-t border-white/10 pt-4 text-[11.5px] leading-relaxed text-ink-faint">
            These documents are shown separately on purpose. Where guidance differs between
            publishers, both positions are reported rather than merged.
          </p>
        )}
      </div>
    </aside>
  );
}
