import { afterEach, describe, expect, it, vi } from "vitest";
import { searchReddit, useRedditProvider } from "@/server/services/reddit";

describe("running out of ScrapeBadger credits", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("says so plainly instead of showing a raw error", async () => {
    vi.stubEnv("SCRAPEBADGER_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":"insufficient_credits"}', { status: 402 })),
    );
    useRedditProvider("scrapebadger");

    await expect(searchReddit('"Acme"')).rejects.toThrow(/out of credits/);
  });
});
