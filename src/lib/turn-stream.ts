import type { TurnEvent, TurnResult } from "@/server/services/onboarding-turn";

export type { TurnEvent, TurnResult };

/**
 * Sends one onboarding message and calls `onEvent` for every event as it
 * arrives. Resolves with the final result.
 */
export async function streamTurn(
  body: {
    message: string;
    conversationHistory: { role: "user" | "assistant"; content: string }[];
    draftId?: string;
    summary?: string;
    known?: {
      companyName?: string;
      product?: string;
      buyer?: string;
      keepWhen?: string;
      notAbout?: string;
      brandKeywords?: { value: string; aliases: string[] }[];
      competitorKeywords?: { value: string }[];
      topicKeywords?: { value: string }[];
      focusAreas?: string[];
    };
  },
  onEvent: (event: TurnEvent) => void,
  signal?: AbortSignal,
): Promise<TurnResult> {
  const response = await fetch("/api/onboarding/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? "The assistant is not reachable right now.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: TurnResult | null = null;

  const handle = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as TurnEvent;
    if (event.type === "done") result = event.result;
    if (event.type === "error") throw new Error(event.message);
    onEvent(event);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(handle);
  }
  handle(buffer + decoder.decode());

  if (!result) throw new Error("The reply was cut off. Try again.");
  return result;
}
