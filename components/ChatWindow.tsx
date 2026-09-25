"use client";

import { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { MessageBubble, type ChatMessage } from "./MessageBubble";
import { ChatInput } from "./ChatInput";
import { SourcesPanel } from "./SourcesPanel";
import { LeafIcon, SettingsIcon, HeroMark, TrashIcon } from "./icons";

const SUGGESTED_QUESTIONS = [
  "How much vitamin C do I need per day?",
  "What temperature is chicken safe at?",
  "How long can leftovers stay in the fridge?",
  "Searing vs. sautéing — what's the difference?",
  "Why does sourdough rise without yeast?",
];

function Header({
  hasMessages,
  isClearing,
  onClear,
}: {
  hasMessages: boolean;
  isClearing: boolean;
  onClear: () => void;
}) {
  return (
    <div className="flex h-[64px] shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4 sm:h-[78px] sm:px-10">
      <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3.5">
        <div className="flex h-[36px] w-[36px] shrink-0 items-center justify-center rounded-xl bg-accent shadow-[0_0_24px_rgba(200,255,77,0.35)] sm:h-[42px] sm:w-[42px]">
          <LeafIcon className="h-[18px] w-[18px] text-bg sm:h-[21px] sm:w-[21px]" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate font-display text-[16px] font-semibold tracking-tight text-ink sm:text-[21px]">
            AI Nutrition Assistant
          </h1>
          <p className="hidden truncate text-[12.5px] text-ink-muted sm:block">
            Grounded, general-knowledge answers — Milestone 1
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
        <span className="hidden rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11.5px] font-medium uppercase tracking-wider text-accent sm:inline-flex">
          No citations yet
        </span>
        {hasMessages && (
          <button
            type="button"
            onClick={onClear}
            disabled={isClearing}
            aria-label="Clear chat history"
            title="Clear chat history"
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-white/10 bg-surface transition hover:border-red-400/40 hover:text-red-400 disabled:opacity-50 sm:h-[38px] sm:w-[38px]"
          >
            <TrashIcon className="h-[15px] w-[15px] text-ink-muted sm:h-[16px] sm:w-[16px]" />
          </button>
        )}
        <button
          type="button"
          aria-label="Settings"
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-white/10 bg-surface sm:h-[38px] sm:w-[38px]"
        >
          <SettingsIcon className="h-[16px] w-[16px] text-ink-muted sm:h-[17px] sm:w-[17px]" />
        </button>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-accent/35 bg-[#1C2320]">
        <LeafIcon className="h-4 w-4 text-accent" />
      </div>
      <div className="flex items-center gap-1.5 rounded-[6px_20px_20px_20px] border border-white/10 bg-surface px-5 py-4 shadow-[0_4px_16px_rgba(0,0,0,0.35)]">
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-ink-muted" style={{ animationDelay: "0ms" }} />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-ink-muted" style={{ animationDelay: "150ms" }} />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-ink-muted" style={{ animationDelay: "300ms" }} />
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (question: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-5 sm:px-10">
      <HeroMark className="mb-5 h-[64px] w-[64px] sm:mb-6 sm:h-[84px] sm:w-[84px]" />
      <h2 className="text-center font-display text-2xl font-semibold tracking-tight text-ink sm:text-4xl">
        What would you like to know?
      </h2>
      <p className="mt-2.5 max-w-[480px] text-center text-sm leading-relaxed text-ink-muted sm:text-base">
        Ask about nutrients, food safety, storage, or cooking. I can&apos;t give calorie targets,
        weight advice, or medical guidance — for that, please see a qualified professional.
      </p>
      <div className="mt-7 flex max-w-[640px] flex-wrap justify-center gap-2.5 sm:mt-9 sm:gap-3.5">
        {SUGGESTED_QUESTIONS.map((q) => (
          <button
            key={q}
            onClick={() => onPick(q)}
            className="rounded-2xl border border-white/10 bg-surface px-3.5 py-2.5 text-sm text-ink transition hover:border-accent/40 hover:bg-white/[0.06] sm:px-[18px] sm:py-[13px]"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ChatWindow() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [isClearing, setIsClearing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  async function handleSend(content: string) {
    setDraft("");
    const userMessage: ChatMessage = { id: uuidv4(), role: "user", content };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: content }),
      });
      const data = await res.json();

      if (data.conversationId) setConversationId(data.conversationId);

      const assistantMessage: ChatMessage = {
        id: uuidv4(),
        role: "assistant",
        content: data.answer ?? "Sorry, something went wrong.",
        claims: data.claims ?? [],
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setSelectedId(assistantMessage.id);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: uuidv4(),
          role: "assistant",
          content: "Sorry, something went wrong reaching the server.",
          claims: [],
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleClear() {
    setIsClearing(true);
    try {
      if (conversationId) {
        await fetch(`/api/chat?conversationId=${encodeURIComponent(conversationId)}`, {
          method: "DELETE",
        });
      }
    } catch {
      // Best-effort: even if the server delete fails, still reset the client
      // view so the user isn't stuck looking at a conversation they asked to clear.
    } finally {
      setMessages([]);
      setConversationId(null);
      setSelectedId(null);
      setDraft("");
      setIsClearing(false);
    }
  }

  const selectedMessage = messages.find((m) => m.id === selectedId) ?? null;
  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-screen bg-bg bg-dot-grid">
      <div className="flex min-w-0 flex-1 flex-col">
        <Header hasMessages={!isEmpty} isClearing={isClearing} onClear={handleClear} />

        <div className={`thin-scrollbar flex flex-1 flex-col overflow-y-auto ${isEmpty ? "bg-dot-grid-hero" : ""}`}>
          {isEmpty ? (
            <EmptyState onPick={setDraft} />
          ) : (
            <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-[18px] px-4 py-6 sm:gap-[22px] sm:px-10 sm:py-9">
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  selected={m.id === selectedId}
                  onSelect={() => setSelectedId(m.id)}
                />
              ))}
              {isLoading && <TypingIndicator />}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-center px-4 pb-5 pt-4 sm:px-10 sm:pb-[26px] sm:pt-[22px]">
          <div className="w-full max-w-[720px]">
            <ChatInput value={draft} onChange={setDraft} disabled={isLoading} onSend={handleSend} />
            <p className="mt-2.5 text-center text-[11.5px] text-ink-faint">
              General information only, not medical advice — please consult a qualified
              professional for personal guidance.
            </p>
          </div>
        </div>
      </div>

      <SourcesPanel selectedMessage={selectedMessage} />
    </div>
  );
}
