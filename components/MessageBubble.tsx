"use client";

import type { Claim } from "@/lib/schema";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  claims?: Claim[];
}

export function MessageBubble({
  message,
  selected,
  onSelect,
}: {
  message: ChatMessage;
  selected: boolean;
  onSelect: () => void;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <button
        onClick={onSelect}
        className={`max-w-[75%] rounded-2xl px-4 py-2 text-left text-sm shadow-sm transition ${
          isUser
            ? "bg-blue-600 text-white"
            : selected
            ? "bg-white ring-2 ring-blue-400"
            : "bg-white hover:ring-1 hover:ring-slate-300"
        }`}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        {!isUser && message.claims && message.claims.length > 0 && (
          <p className="mt-1 text-xs text-slate-400">
            {message.claims.length} claim{message.claims.length === 1 ? "" : "s"} — click to view sources
          </p>
        )}
      </button>
    </div>
  );
}
