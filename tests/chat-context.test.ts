import { describe, expect, it } from "vitest";
import { packHistory } from "@/lib/chat-context";

const messages = Array.from({ length: 10 }, (_, index) => ({ role: index % 2 === 0 ? "user" : "assistant", content: `turn ${index}` }));

describe("packHistory", () => {
  it("sends a short chat in full", () => {
    const packed = packHistory(messages.slice(0, 6), "They sell home decor.");
    expect(packed.trimmed).toBe(false);
    expect(packed.history).toHaveLength(6);
  });

  it("keeps the saved summary and the latest messages once the chat is long", () => {
    const packed = packHistory(messages, "They sell home decor. They want found: bad reviews.");
    expect(packed.trimmed).toBe(true);
    expect(packed.history.map((message) => message.content)).toEqual(["turn 6", "turn 7", "turn 8", "turn 9"]);
    expect(packed.summary).toContain("home decor");
  });

  it("does not drop old messages when there is no summary yet", () => {
    const packed = packHistory(messages, "");
    expect(packed.trimmed).toBe(false);
    expect(packed.history).toHaveLength(10);
  });
});
