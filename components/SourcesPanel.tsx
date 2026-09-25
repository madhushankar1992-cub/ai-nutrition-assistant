"use client";

import type { ChatMessage } from "./MessageBubble";

export function SourcesPanel({ selectedMessage }: { selectedMessage: ChatMessage | null }) {
  const claims = selectedMessage?.claims ?? [];

  return (
    <aside className="flex h-full w-80 flex-col border-l border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">Sources</h2>

      {!selectedMessage && (
        <p className="text-sm text-slate-400">
          Select an assistant message to view its claims and sources.
        </p>
      )}

      {selectedMessage && claims.length === 0 && (
        <p className="text-sm text-slate-400">No claims recorded for this message.</p>
      )}

      <ul className="space-y-3 overflow-y-auto">
        {claims.map((claim, i) => (
          <li key={i} className="rounded-lg border border-slate-100 p-3">
            <p className="text-sm text-slate-800">{claim.text}</p>
            {claim.source === null ? (
              <p className="mt-1 text-xs italic text-slate-400">
                No source yet — Milestone 2 will add citations.
              </p>
            ) : (
              <a
                href={claim.source}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block truncate text-xs text-blue-600 underline"
              >
                {claim.source}
              </a>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
