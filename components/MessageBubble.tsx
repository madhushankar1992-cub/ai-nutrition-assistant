"use client";

import type { Claim } from "@/lib/schema";
import { LeafIcon, SourcesIcon } from "./icons";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  claims?: Claim[];
}

const SELECTED_SHADOW =
  "shadow-[0_0_0_1.5px_#C8FF4D,0_0_28px_rgba(200,255,77,0.18),0_10px_24px_-8px_rgba(0,0,0,0.5)]";
const REST_SHADOW = "shadow-[0_4px_16px_rgba(0,0,0,0.35)]";

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

  if (isUser) {
    return (
      <div className="message-enter flex justify-end">
        <div className="max-w-[80%] rounded-[20px_6px_20px_20px] bg-accent px-5 py-3.5 text-[15px] font-medium leading-relaxed text-bg sm:max-w-[62%]">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="message-enter flex items-start gap-3">
      <div className="mt-0.5 flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-accent/35 bg-[#1C2320]">
        <LeafIcon className="h-4 w-4 text-accent" />
      </div>
      <button
        onClick={onSelect}
        className={`max-w-[80%] rounded-[6px_20px_20px_20px] border border-white/10 bg-surface px-5 py-4 text-left text-[15px] leading-relaxed text-ink transition sm:max-w-[78%] ${
          selected ? SELECTED_SHADOW : REST_SHADOW
        }`}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        {message.claims && message.claims.length > 0 && (
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11.5px] font-medium text-ink-muted">
            <SourcesIcon className="h-3 w-3" />
            {message.claims.length} claim{message.claims.length === 1 ? "" : "s"}
          </span>
        )}
      </button>
    </div>
  );
}
