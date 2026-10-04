"use client";

import { useRef } from "react";
import { SendIcon } from "./icons";
import { MAX_MESSAGE_CHARS } from "@/lib/limits";

/** Show the character counter once a message gets this close to the limit. */
const COUNTER_FROM = MAX_MESSAGE_CHARS - 500;

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

  // The server rejects anything over MAX_MESSAGE_CHARS with a 400, which the
  // chat used to surface as a generic error after a long paste. Check the
  // trimmed text, because that is what is sent. The paste is NOT truncated
  // (no maxLength): silently cutting a question in half is worse than asking
  // the user to shorten it.
  const length = value.trim().length;
  const tooLong = length > MAX_MESSAGE_CHARS;
  const showCounter = value.length >= COUNTER_FROM;

  function resize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled || trimmed.length > MAX_MESSAGE_CHARS) return;
    onSend(trimmed);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  return (
    <div>
      <div
        className={`flex items-end gap-2.5 rounded-3xl border bg-surface px-3 py-2 transition focus-within:ring-2 ${tooLong ? "border-red-400/60 focus-within:border-red-400/60 focus-within:ring-red-400/20" : "border-white/10 focus-within:border-accent/60 focus-within:ring-accent/20"}`}
      >
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
          aria-invalid={tooLong}
          aria-describedby={showCounter ? "composer-limit" : undefined}
          placeholder="Ask about food, nutrition, cooking, or food safety…"
          className="max-h-[120px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none disabled:text-ink-faint"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim() || tooLong}
          aria-label="Send message"
          className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-accent shadow-[0_0_18px_rgba(200,255,77,0.3)] transition hover:brightness-110 disabled:bg-white/10 disabled:shadow-none"
        >
          <SendIcon className="h-[17px] w-[17px] translate-x-[1px] text-bg" />
        </button>
      </div>
      {showCounter && (
        <p
          id="composer-limit"
          role={tooLong ? "alert" : undefined}
          className={`mt-1.5 px-3 text-right text-[11.5px] ${tooLong ? "text-red-400" : "text-ink-faint"}`}
        >
          {tooLong
            ? `Message is too long: ${length.toLocaleString()} / ${MAX_MESSAGE_CHARS.toLocaleString()} characters. Shorten it to send.`
            : `${length.toLocaleString()} / ${MAX_MESSAGE_CHARS.toLocaleString()} characters`}
        </p>
      )}
    </div>
  );
}
