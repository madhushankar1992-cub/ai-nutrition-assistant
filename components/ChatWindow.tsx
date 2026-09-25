"use client";

import { useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { MessageBubble, type ChatMessage } from "./MessageBubble";
import { ChatInput } from "./ChatInput";
import { SourcesPanel } from "./SourcesPanel";

export function ChatWindow() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSend(content: string) {
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

  const selectedMessage = messages.find((m) => m.id === selectedId) ?? null;

  return (
    <div className="flex h-screen">
      <div className="flex flex-1 flex-col">
        <header className="border-b border-slate-200 bg-white p-4">
          <h1 className="text-lg font-semibold">AI Nutrition Assistant</h1>
          <p className="text-xs text-slate-400">
            Milestone 1 — general knowledge only, no citations yet.
          </p>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <p className="text-sm text-slate-400">
              Ask a question about nutrition, cooking, or food safety to get started.
            </p>
          )}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              selected={m.id === selectedId}
              onSelect={() => setSelectedId(m.id)}
            />
          ))}
          {isLoading && <p className="text-sm text-slate-400">Thinking…</p>}
        </div>

        <ChatInput disabled={isLoading} onSend={handleSend} />
      </div>

      <SourcesPanel selectedMessage={selectedMessage} />
    </div>
  );
}
