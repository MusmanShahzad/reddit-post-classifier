/**
 * Reddit Data API client tests.
 *
 * Network tests stub `fetch`. They check OAuth token exchange, the official
 * search URL, and bounded retries on HTTP 429.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  topicWords,
  filterSubredditsByTopic,
  searchReddit,
  searchSubreddits,
  clearRedditTokenCache,
  useRedditProvider,
} from "@/server/services/reddit";
import { ProviderWaitError, retryAfterMs } from "@/server/services/reddit/http";

const POST = {
  id: "abc",
  name: "t3_abc",
  title: "Acme is down",
  selftext: "",
  subreddit: "SaaS",
  author: "user",
  score: 3,
  num_comments: 1,
  url: "https://example.com",
  permalink: "/r/SaaS/comments/abc/acme_is_down/",
  created_utc: 1700000000,
  is_self: true,
  link_flair_text: null,
};

function json(status: number, payload: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function tokenOk(): Response {
  return json(200, { access_token: "test-token", expires_in: 3600 });
}

function listing(posts: object[]): Response {
  return json(200, {
    data: { children: posts.map((post) => ({ data: post })), after: null },
  });
}

describe("Reddit Data API search", () => {
  beforeEach(() => {
    useRedditProvider("reddit");
  });

  afterEach(() => {
    clearRedditTokenCache();
    useRedditProvider("scrapebadger");
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("exchanges client credentials and searches oauth.reddit.com", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(listing([POST]));
    vi.stubGlobal("fetch", fetchMock);

    const posts = await searchReddit("acme", { subreddit: "SaaS", limit: 25 });

    expect(posts).toHaveLength(1);
    expect(posts[0]?.id).toBe("abc");

    const tokenCall = fetchMock.mock.calls[0];
    expect(tokenCall?.[0]).toBe("https://www.reddit.com/api/v1/access_token");
    expect(String(tokenCall?.[1]?.body)).toContain("grant_type=client_credentials");

    const searchUrl = String(fetchMock.mock.calls[1]?.[0]);
    expect(searchUrl).toContain("https://oauth.reddit.com/r/SaaS/search.json");
    expect(searchUrl).toContain("restrict_sr=true");
    expect(fetchMock.mock.calls[1]?.[1]?.headers?.Authorization).toBe("Bearer test-token");
  });

  it("retries a 429 and then returns posts", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "1" } }))
      .mockResolvedValueOnce(listing([POST]));
    vi.stubGlobal("fetch", fetchMock);

    const pending = searchReddit("acme", { subreddit: "SaaS" });
    await vi.runAllTimersAsync();
    const posts = await pending;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(posts).toHaveLength(1);
  });

  it("does not retry a 400", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenOk())
      .mockResolvedValueOnce(json(400, { message: "Bad Request" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchReddit("acme", { subreddit: "SaaS" })).rejects.toThrow(/400/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the maximum number of 429 responses", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return tokenOk();
      return new Response("", { status: 429, headers: { "Retry-After": "1" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = searchReddit("acme", { subreddit: "SaaS" });
    const assertion = expect(pending).rejects.toThrow(/429/);
    await vi.runAllTimersAsync();
    await assertion;

    // 1 token request + 5 rate-limited search attempts.
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});

describe("ScrapeBadger provider", () => {
  beforeEach(() => {
    useRedditProvider("scrapebadger");
    vi.stubEnv("SCRAPEBADGER_API_KEY", "sb-test");
  });

  afterEach(() => {
    useRedditProvider("scrapebadger");
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("telling the queue to wait", () => {
    const failure = async (response: Response | Error) => {
      vi.stubGlobal("fetch", vi.fn(async () => {
        if (response instanceof Error) throw response;
        return response;
      }));
      return searchReddit("acme", { retryThrottles: false }).catch((error: unknown) => error);
    };

    it("reports a 429 at once with the wait the source asked for", async () => {
      const error = await failure(new Response("", { status: 429, headers: { "Retry-After": "120" } }));

      expect(fetch).toHaveBeenCalledTimes(1);
      expect(error).toBeInstanceOf(ProviderWaitError);
      expect(error).toMatchObject({ kind: "rate_limit", retryAfterMs: 120_000 });
    });

    it("reports an empty balance", async () => {
      expect(await failure(new Response("", { status: 402 }))).toMatchObject({ kind: "no_credits" });
    });

    it.each([500, 502, 503, 504])("reports a %i as an outage", async (status) => {
      expect(await failure(new Response("", { status }))).toMatchObject({ kind: "outage" });
    });

    it("reports a timeout or dropped connection as an outage", async () => {
      expect(await failure(new TypeError("fetch failed"))).toMatchObject({
        kind: "outage",
        message: expect.stringContaining("fetch failed"),
      });
    });

    it("does not wait on a rejected key, which waiting cannot fix", async () => {
      const error = await failure(new Response("", { status: 401 }));
      expect(error).not.toBeInstanceOf(ProviderWaitError);
    });

    it("reads Retry-After as seconds or as a date", () => {
      const now = Date.parse("2026-01-01T00:00:00Z");
      const asked = (value: string) => retryAfterMs(new Response("", { headers: { "Retry-After": value } }), now);

      expect(asked("15")).toBe(15_000);
      expect(asked("Thu, 01 Jan 2026 00:01:00 GMT")).toBe(60_000);
      expect(asked("Wed, 31 Dec 2025 00:00:00 GMT")).toBeNull();
      expect(asked("soon")).toBeNull();
      expect(asked("0")).toBeNull();
      expect(retryAfterMs(new Response(""), now)).toBeNull();
      const window = (reset: number) => retryAfterMs(new Response("", { headers: { "X-RateLimit-Reset": String(reset) } }), now);
      expect(window(now / 1000 + 15)).toBe(15_000);
      expect(window(now / 1000 - 15)).toBeNull();
    });

    it("passes a long wait straight up instead of sleeping on it", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 429, headers: { "Retry-After": "3600" } })));

      await expect(searchReddit("acme")).rejects.toMatchObject({ kind: "rate_limit", retryAfterMs: 3_600_000 });
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  it("searches posts with the API key header and maps the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, {
      posts: [{
        id: "abc",
        fullname: "t3_abc",
        title: "Acme is down",
        selftext: "details",
        subreddit: "SaaS",
        author: "user",
        score: 3,
        num_comments: 1,
        url: "https://example.com",
        permalink: "https://www.reddit.com/r/SaaS/comments/abc/acme_is_down/",
        created_utc: 1700000000.9,
        is_self: false,
        link_flair_text: "Help",
      }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const posts = await searchReddit("acme", { subreddit: "r/SaaS", sort: "new", timeframe: "week", limit: 25 });

    expect(posts).toEqual([
      expect.objectContaining({
        id: "abc",
        name: "t3_abc",
        permalink: "/r/SaaS/comments/abc/acme_is_down/",
        created_utc: 1700000000,
        link_flair_text: "Help",
      }),
    ]);

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("https://scrapebadger.com/v1/reddit/search/posts?");
    expect(url).toContain("subreddit=SaaS");
    expect(url).toContain("sort=new");
    expect(url).toContain("t=week");
    expect(url).toContain("limit=25");
    expect(fetchMock.mock.calls[0]?.[1]?.headers?.["X-API-Key"]).toBe("sb-test");
  });

  it("covers several subreddits in one search", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { posts: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchReddit("acme", { subreddits: ["SaaS", "startups", "r/webdev"] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("subreddit")).toBe("SaaS+startups+webdev");
    expect(url.searchParams.get("limit")).toBe("100");
  });

  it("splits a subreddit list that would exceed the 256 byte search limit", async () => {
    const fetchMock = vi.fn(async () => json(200, { posts: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const names = Array.from({ length: 40 }, (_, index) => `community${index}name`);

    await searchReddit("acme monitoring tool", { subreddits: names });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    const covered = (fetchMock.mock.calls as unknown as unknown[][]).flatMap((call) => {
      const url = new URL(String(call[0]));
      return (url.searchParams.get("subreddit") ?? "").split("+").filter(Boolean);
    });
    expect(covered).toEqual(names);
  });

  it("does not retry a rejected API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchReddit("acme")).rejects.toThrow(/API key/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 and then returns posts", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "1" } }))
      .mockResolvedValueOnce(json(200, { posts: [{ id: "abc", title: "Acme" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = searchReddit("acme");
    await vi.runAllTimersAsync();

    expect(await pending).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when the API key is missing", async () => {
    vi.stubEnv("SCRAPEBADGER_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchReddit("acme")).rejects.toThrow(/SCRAPEBADGER_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("filters subreddit suggestions the same way for this provider", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, {
      subreddits: [
        { name: "cars", subscribers: 1_000_000, public_description: "Everything about cars" },
        { name: "cardano", subscribers: 800_000, public_description: "Cardano blockchain" },
        { name: "tiny", subscribers: 10, public_description: "cars and repair" },
      ],
    })));

    const subs = await searchSubreddits("car", 5);
    expect(subs.map((sub) => sub.name)).toEqual(["cars"]);
  });
});

describe("topicWords", () => {
  it("lowercases and splits on non-alphanumeric characters", () => {
    expect(topicWords("Auto-Repair Shop")).toEqual(["auto", "repair", "shop"]);
  });

  it("keeps 3-letter words and drops 1-2 letter words", () => {
    expect(topicWords("car ai to")).toEqual(["car"]);
  });

  it("drops generic stopwords", () => {
    expect(topicWords("auto repair software")).toEqual(["auto", "repair"]);
  });

  it("returns an empty array for empty input", () => {
    expect(topicWords("")).toEqual([]);
  });
});

describe("filterSubredditsByTopic", () => {
  const subs = [
    { name: "cars", description: "Everything about cars and car culture" },
    { name: "cardano", description: "Cardano blockchain and ADA cryptocurrency" },
    { name: "carporn", description: "Photos of beautiful cars" },
    { name: "careeradvice", description: "Job hunting and career help" },
    { name: "MechanicAdvice", description: "Ask a mechanic about car repair" },
    { name: "MechanicalKeyboards", description: "Mechanical keyboard enthusiasts" },
  ];

  it("keeps subreddits whose description mentions a topic word", () => {
    const result = filterSubredditsByTopic("mechanic repair", subs).map((s) => s.name);
    expect(result).toContain("MechanicAdvice");
  });

  it("drops prefix-only false positives such as cardano and careeradvice", () => {
    const result = filterSubredditsByTopic("car", subs).map((s) => s.name);
    expect(result).not.toContain("cardano");
    expect(result).not.toContain("careeradvice");
  });

  it("drops MechanicalKeyboards when the topic is about auto repair", () => {
    const result = filterSubredditsByTopic("auto repair", subs).map((s) => s.name);
    expect(result).not.toContain("MechanicalKeyboards");
  });

  it("keeps a subreddit whose name exactly equals a topic word", () => {
    const result = filterSubredditsByTopic("cars", [
      { name: "cars", description: "" },
    ]);
    expect(result).toHaveLength(1);
  });

  it("returns every subreddit when the topic has no usable words", () => {
    const result = filterSubredditsByTopic("ai to", subs);
    expect(result).toHaveLength(subs.length);
  });

  it("does not match 'car' inside 'career'", () => {
    const result = filterSubredditsByTopic("car", [
      { name: "careeradvice", description: "Job hunting and career help" },
    ]);
    expect(result).toEqual([]);
  });

  it("matches plural forms of a topic word", () => {
    const result = filterSubredditsByTopic("car", [
      { name: "x", description: "Discussion about cars" },
    ]);
    expect(result).toHaveLength(1);
  });

  it("returns an empty array when no description matches", () => {
    const result = filterSubredditsByTopic("payroll", subs);
    expect(result).toEqual([]);
  });
});
