"use client";

import type { ChatMessage } from "./MessageBubble";
import { SourcesIcon } from "./icons";

export function SourcesPanel({ selectedMessage }: { selectedMessage: ChatMessage | null }) {
  const claims = selectedMessage?.claims ?? [];

  return (
    <aside className="hidden w-[340px] shrink-0 flex-col border-l border-white/10 bg-surface-dim md:flex">
      <div className="border-b border-white/10 px-6 py-5">
        <h2 className="font-display text-lg font-semibold text-ink">Sources</h2>
        <p className="mt-1 text-[12.5px] text-ink-muted">Claims behind the selected reply</p>
      </div>

      <div className="thin-scrollbar flex-1 overflow-y-auto px-5 py-5">
        {!selectedMessage && (
          <p className="text-sm text-ink-faint">
            Select an assistant reply to see the claims and sources behind it.
          </p>
        )}

        {selectedMessage && claims.length === 0 && (
          <p className="text-sm text-ink-faint">No claims recorded for this message.</p>
        )}

        <ul className="space-y-3">
          {claims.map((claim, i) => (
            <li key={i}>
              {claim.source === null ? (
                <div className="rounded-2xl border border-dashed border-white/[0.16] bg-surface-card p-4">
                  <p className="text-[13.5px] leading-snug text-ink">{claim.text}</p>
                  <p className="mt-2.5 text-xs italic text-ink-faint">
                    No source yet — arriving in Milestone 2.
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border border-accent/35 bg-accent/10 p-4">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wider text-accent">
                    Source
                  </span>
                  <p className="mt-2 text-[13.5px] leading-snug text-ink">{claim.text}</p>
                  <a
                    href={claim.source}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2.5 flex items-center gap-1.5 truncate text-xs text-accent underline decoration-accent/40 hover:decoration-accent"
                  >
                    <SourcesIcon className="h-3 w-3 shrink-0" />
                    {claim.source}
                  </a>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
