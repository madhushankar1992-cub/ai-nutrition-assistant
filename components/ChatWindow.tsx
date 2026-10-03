"use client";

import { useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { MessageBubble, type ChatMessage } from "./MessageBubble";
import { ChatInput } from "./ChatInput";
import { SourcesPanel } from "./SourcesPanel";
import { LeafIcon, HeroMark, TrashIcon } from "./icons";

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
            Answers grounded in official dietary guidance, with citations
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
        <span className="hidden rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11.5px] font-medium uppercase tracking-wider text-accent sm:inline-flex">
          Select an answer to see its sources
        </span>
        {hasMessages && (
          <button
            type="button"
            onClick={onClear}
            disabled={isClearing}
            aria-label="Clear this chat"
            title="Clear this chat"
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border border-white/10 bg-surface transition hover:border-red-400/40 hover:text-red-400 disabled:opacity-50 sm:h-[38px] sm:w-[38px]"
          >
            <TrashIcon className="h-[15px] w-[15px] text-ink-muted sm:h-[16px] sm:w-[16px]" />
          </button>
        )}
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

// --- Multi-threaded sessions -----------------------------------------------
// Each thread owns its own conversationId, messages, draft and loading flag.
// Nothing is shared between threads, so two can be in flight at once and
// neither can see the other's history.
//
// Isolation comes from three things:
//   - The server already loads prior turns by conversationId, so threads are
//     separated in the database. This mirrors that separation in the client.
//   - Every state update is keyed by session id instead of written to one
//     shared variable. Previously a reply wrote conversationId into a single
//     piece of state, so a second message sent before the first returned could
//     attach itself to the wrong conversation.
//   - isLoading is per thread, so sending in one thread no longer disables the
//     input in all the others.

interface Session {
  id: string;
  title: string;
  conversationId: string | null;
  messages: ChatMessage[];
  selectedId: string | null;
  draft: string;
  isLoading: boolean;
}

const STORAGE_KEY = "nutrition-assistant-sessions-v1";
const MAX_SESSIONS = 20;

function newSession(index = 1): Session {
  return {
    id: uuidv4(),
    title: "Chat " + index,
    conversationId: null,
    messages: [],
    selectedId: null,
    draft: "",
    isLoading: false,
  };
}

/** Name a thread after its first question, so the list is scannable. */
function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= 38 ? t : t.slice(0, 37).trimEnd() + "…";
}

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Session[];
    if (!Array.isArray(parsed) || !parsed.length) return [];
    // isLoading is never restored: an in-flight request did not survive a reload.
    return parsed.slice(0, MAX_SESSIONS).map((s) => ({ ...s, isLoading: false }));
  } catch {
    return [];
  }
}

function saveSessions(sessions: Session[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch {
    // Private mode or blocked storage. Threads still work for this page view.
  }
}

function ThreadRail({
  sessions,
  activeId,
  onSelect,
  onNew,
  onClose,
}: {
  sessions: Session[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: (id: string) => void;
}) {
  return (
    <aside className="hidden w-[232px] shrink-0 flex-col border-r border-white/10 bg-surface-dim md:flex">
      <div className="flex h-[78px] shrink-0 items-center px-4">
        <button
          type="button"
          onClick={onNew}
          className="w-full rounded-xl border border-accent/30 bg-accent/10 px-3 py-2.5 text-[13px] font-medium text-accent transition hover:bg-accent/20"
        >
          + New chat
        </button>
      </div>
      <div className="thin-scrollbar flex-1 overflow-y-auto px-2.5 pb-4">
        {sessions.map((s) => {
          const isActive = s.id === activeId;
          return (
            <div
              key={s.id}
              className={
                "group mb-1 flex items-center gap-1 rounded-lg px-2.5 py-2 text-[13px] transition " +
                (isActive ? "bg-white/[0.08] text-ink" : "text-ink-muted hover:bg-white/[0.04]")
              }
            >
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                className="min-w-0 flex-1 truncate text-left"
                title={s.title}
              >
                {s.isLoading && <span className="mr-1.5 text-accent">&bull;</span>}
                {s.title}
              </button>
              {sessions.length > 1 && (
                <button
                  type="button"
                  onClick={() => onClose(s.id)}
                  aria-label={"Close " + s.title}
                  className="shrink-0 rounded px-1 text-ink-faint opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                >
                  &times;
                </button>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export function ChatWindow() {
  const [sessions, setSessions] = useState<Session[]>(() => [newSession(1)]);
  const [activeId, setActiveId] = useState<string>("");
  const [isClearing, setIsClearing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Restore threads on mount rather than in useState, so the server render and
  // the first client render agree (localStorage does not exist on the server).
  useEffect(() => {
    const restored = loadSessions();
    if (restored.length) {
      setSessions(restored);
      setActiveId(restored[0].id);
    } else {
      setActiveId((prev) => prev || sessions[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (sessions.length) saveSessions(sessions);
  }, [sessions]);

  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages, active?.isLoading]);

  /** Update exactly one session. This is what keeps threads isolated. */
  function patch(sessionId: string, update: (s: Session) => Session) {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? update(s) : s)));
  }

  function handleNew() {
    const created = newSession(sessions.length + 1);
    setSessions((prev) => [created, ...prev].slice(0, MAX_SESSIONS));
    setActiveId(created.id);
  }

  function handleClose(id: string) {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      const safe = next.length ? next : [newSession(1)];
      if (id === activeId) setActiveId(safe[0].id);
      return safe;
    });
  }

  async function handleSend(content: string) {
    // Capture the thread now: the user may switch threads while this request is
    // in flight, and the reply must still land in the thread it came from.
    const sessionId = active.id;
    let conversationId = active.conversationId;
    const userMessage: ChatMessage = { id: uuidv4(), role: "user", content };

    patch(sessionId, (s) => ({
      ...s,
      draft: "",
      messages: [...s.messages, userMessage],
      isLoading: true,
      title: s.messages.length === 0 ? titleFrom(content) : s.title,
    }));

    try {
      let res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: content }),
      });

      // 404 means the server will not accept this conversationId for us: the
      // owner cookie was cleared or expired while the id lived on in
      // localStorage, or the thread was opened in another browser profile.
      // Without this the thread is bricked permanently - every later send gets
      // the same 404 and the user sees "something went wrong" forever, with no
      // way back except clearing site data. Retry once as a NEW conversation so
      // the thread keeps working; prior turns stay visible but are not resent,
      // which is correct, since the server has refused us access to them.
      if (res.status === 404 && conversationId) {
        conversationId = null;
        res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: content }),
        });
      }

      const data = await res.json();

      const assistantMessage: ChatMessage = {
        id: uuidv4(),
        role: "assistant",
        content: data.answer ?? "Sorry, something went wrong.",
        claims: data.claims ?? [],
      };

      patch(sessionId, (s) => ({
        ...s,
        conversationId: data.conversationId ?? s.conversationId,
        messages: [...s.messages, assistantMessage],
        selectedId: assistantMessage.id,
        isLoading: false,
      }));
    } catch {
      patch(sessionId, (s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            id: uuidv4(),
            role: "assistant",
            content: "Sorry, something went wrong reaching the server.",
            claims: [],
          },
        ],
        isLoading: false,
      }));
    }
  }

  async function handleClear() {
    const sessionId = active.id;
    const conversationId = active.conversationId;
    setIsClearing(true);
    try {
      if (conversationId) {
        await fetch("/api/chat?conversationId=" + encodeURIComponent(conversationId), {
          method: "DELETE",
        });
      }
    } catch {
      // Best-effort: even if the server delete fails, still reset this thread's
      // view so the user isn't stuck looking at a conversation they cleared.
    } finally {
      patch(sessionId, (s) => ({
        ...s,
        messages: [],
        conversationId: null,
        selectedId: null,
        draft: "",
        isLoading: false,
      }));
      setIsClearing(false);
    }
  }

  if (!active) return null;

  const selectedMessage = active.messages.find((m) => m.id === active.selectedId) ?? null;
  const isEmpty = active.messages.length === 0;

  return (
    <div className="flex h-screen bg-bg bg-dot-grid">
      <ThreadRail
        sessions={sessions}
        activeId={active.id}
        onSelect={setActiveId}
        onNew={handleNew}
        onClose={handleClose}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header hasMessages={!isEmpty} isClearing={isClearing} onClear={handleClear} />

        <div className={`thin-scrollbar flex flex-1 flex-col overflow-y-auto ${isEmpty ? "bg-dot-grid-hero" : ""}`}>
          {isEmpty ? (
            <EmptyState onPick={(q) => patch(active.id, (s) => ({ ...s, draft: q }))} />
          ) : (
            <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-[18px] px-4 py-6 sm:gap-[22px] sm:px-10 sm:py-9">
              {active.messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  selected={m.id === active.selectedId}
                  onSelect={() => patch(active.id, (s) => ({ ...s, selectedId: m.id }))}
                />
              ))}
              {active.isLoading && <TypingIndicator />}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-center px-4 pb-5 pt-4 sm:px-10 sm:pb-[26px] sm:pt-[22px]">
          <div className="w-full max-w-[720px]">
            <ChatInput
              value={active.draft}
              onChange={(v) => patch(active.id, (s) => ({ ...s, draft: v }))}
              disabled={active.isLoading}
              onSend={handleSend}
            />
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
