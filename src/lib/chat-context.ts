/** Send the full transcript until the chat reaches this many messages. */
export const HISTORY_BEFORE_SUMMARY = 8;

/** How many of the latest messages stay verbatim after the summary takes over. */
export const RECENT_MESSAGES = 4;

export interface PackedHistory<T> {
  history: T[];
  summary: string;
  /** True when older messages were left out because the summary carries them. */
  trimmed: boolean;
}

/**
 * Once a chat is long, the model gets the saved summary plus the latest
 * messages. Shorter chats are sent in full, with the summary alongside.
 */
export function packHistory<T>(messages: T[], summary: string): PackedHistory<T> {
  const saved = summary.trim();
  if (messages.length <= HISTORY_BEFORE_SUMMARY || !saved) {
    return { history: messages, summary: saved, trimmed: false };
  }
  return { history: messages.slice(-RECENT_MESSAGES), summary: saved, trimmed: true };
}
