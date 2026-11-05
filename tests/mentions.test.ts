import { describe, expect, it } from "vitest";
import { postMentions } from "@/lib/mentions";
import { rateLimitWait } from "@/lib/rate-limit";

const keywords = [
  { type: "brand", value: "QuickBooks", aliases: '["QB", "Quick Books"]' },
  { type: "competitor", value: "Xero", aliases: "[]" },
  { type: "topic", value: "accounting software", aliases: "[]" },
];

const mentions = (title: string, body = "", author = "writer") => postMentions({ title, body, author }, keywords);

describe("postMentions", () => {
  it("finds tracked names and leaves out topics", () => {
    expect(mentions("Quick Books vs Xero accounting software").names).toEqual([
      { value: "QuickBooks", type: "brand" },
      { value: "Xero", type: "competitor" },
    ]);
  });

  it("does not count a very short alias, which also means other things", () => {
    expect(mentions("Our QB threw four touchdowns").names).toEqual([]);
  });

  it("finds Reddit users once each and leaves out the author", () => {
    expect(mentions("Asking /u/Helper_1", "u/helper_1 and u/other said so, says u/WRITER").people).toEqual([
      "helper_1",
      "other",
    ]);
  });

  it("does not read a web address as a user", () => {
    expect(mentions("See https://example.com/u/nobody").people).toEqual([]);
  });

  it("returns nothing for a post with no mentions", () => {
    expect(mentions("Plain text")).toEqual({ names: [], people: [] });
  });
});

describe("rateLimitWait", () => {
  it("reads the wait Jev gives", () => {
    expect(rateLimitWait(Object.assign(new Error("x"), { status: 429, retryAfterMs: 2000 }))).toEqual({ retryAfterMs: 2000 });
  });

  it("reads the wait from OpenAI's headers", () => {
    const error = Object.assign(new Error("x"), { status: 429, headers: new Headers({ "retry-after": "3" }) });
    expect(rateLimitWait(error)).toEqual({ retryAfterMs: 3000 });
  });

  it("recognises a limit with no stated wait", () => {
    expect(rateLimitWait(Object.assign(new Error("x"), { status: 503 }))).toEqual({ retryAfterMs: null });
    expect(rateLimitWait(new Error("429 rate limit exceeded"))).toEqual({ retryAfterMs: null });
  });

  it("does not mistake other failures for a limit", () => {
    expect(rateLimitWait(Object.assign(new Error("rate limit"), { status: 400 }))).toBeNull();
    expect(rateLimitWait(new Error("Malformed response"))).toBeNull();
    expect(rateLimitWait("oops")).toBeNull();
  });
});
