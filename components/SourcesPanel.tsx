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

export function SourcesPanel({ selectedMessage }: { selectedMessage: ChatMessage | null }) {
  const claims = selectedMessage?.claims ?? [];

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
          <p className="text-sm text-ink-faint">
            No citations for this message — it was a refusal, or the guidance didn&apos;t cover
            the question.
          </p>
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
                {group.items.map((claim, i) => (
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
                  </li>
                ))}
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
