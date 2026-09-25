"use client";

import { useRef } from "react";
import { SendIcon } from "./icons";

export function ChatInput({
  value,
  onChange,
  disabled,
  onSend,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  onSend: (message: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function resize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  return (
    <div className="flex items-end gap-2.5 rounded-3xl border border-white/10 bg-surface px-3 py-2 transition focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/20">
      <label htmlFor="composer" className="sr-only">
        Ask a question
      </label>
      <textarea
        id="composer"
        ref={textareaRef}
        rows={1}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          resize(e.target);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        disabled={disabled}
        placeholder="Ask about food, nutrition, cooking, or food safety…"
        className="max-h-[120px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none disabled:text-ink-faint"
      />
      <button
        type="button"
        onClick={submit}
        disabled={disabled || !value.trim()}
        aria-label="Send message"
        className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-accent shadow-[0_0_18px_rgba(200,255,77,0.3)] transition hover:brightness-110 disabled:bg-white/10 disabled:shadow-none"
      >
        <SendIcon className="h-[17px] w-[17px] translate-x-[1px] text-bg" />
      </button>
    </div>
  );
}
