export interface HistoryTurn { role: string; content: string }

/** Server error replies contain no useful model context; failed attempts are retryable. */
export function answeredHistory<T extends HistoryTurn>(history: T[]): T[] {
  const result: T[] = [];
  for (let i = 0; i < history.length; i++) {
    const turn = history[i];
    const reply = history[i + 1];
    if (turn.role === "user" && reply?.role === "assistant" &&
      /^(?:The assistant is at capacity right now\.|The assistant is temporarily unavailable\.|The response took too long\.|Sorry, something went wrong generating a response\.|I can't reach my reference library right now,)/.test(reply.content)) {
      i++;
      continue;
    }
    result.push(turn);
  }
  return result;
}
