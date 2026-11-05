import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Runs the real collector against a temp database. Reddit, the classifier
 * and OpenAI are replaced, so no credit is spent.
 */
const mocks = vi.hoisted(() => ({
  searchReddit: vi.fn(),
  getRedditUser: vi.fn(),
  classifyPost: vi.fn(),
  generatePostReason: vi.fn(),
}));

vi.mock("@/server/services/reddit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/reddit")>();
  return {
    ...actual,
    searchReddit: (...args: unknown[]) => mocks.searchReddit(...args),
    getRedditUser: (...args: unknown[]) => mocks.getRedditUser(...args),
  };
});
vi.mock("@/server/services/classifier", () => ({
  classifyPost: (...args: unknown[]) => mocks.classifyPost(...args),
  reasonIsBacked: async () => true,
}));
vi.mock("@/server/services/openai", () => ({
  generatePostReason: (...args: unknown[]) => mocks.generatePostReason(...args),
}));

import { droppedPosts } from "@/lib/search-stats";
import { authorConfig } from "@/server/services/authors";
import {
  collectorConfig,
  MAX_CLASSIFY_ATTEMPTS,
  MAX_CONSECUTIVE_CLASSIFY_FAILURES,
  runCollection,
  type CollectionEvent,
} from "@/server/services/collector";
import { ProviderWaitError } from "@/server/services/reddit/http";
import { claimNextSearch, completeSearch, ensureSearchJobs, MAX_OUTAGE_TRIES, settleInterruptedRun } from "@/server/services/search-queue";
import { createTestDb, seedCompany, type TestDb } from "./helpers/test-db";

let handle: Awaited<ReturnType<typeof createTestDb>>;
let db: TestDb;
let companyId: string;

type Fetched = Record<string, unknown[] | Error>;
let results: Fetched = {};

beforeAll(async () => {
  handle = await createTestDb();
  db = handle.db;
  collectorConfig.delayBetweenQueriesMs = 0;
  collectorConfig.classifyPollMs = 2;
  authorConfig.delayBetweenLookupsMs = 0;
  authorConfig.pollMs = 2;
}, 120_000);

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await handle.reset();
  companyId = (await seedCompany(db)).id;
  results = {};
  vi.clearAllMocks();
  collectorConfig.classifyConcurrency = 1;
  await db.appSettings.deleteMany();
  mocks.getRedditUser.mockResolvedValue(null);

  mocks.searchReddit.mockImplementation(async (query: string) => {
    const found = results[query];
    if (found instanceof Error) throw found;
    return found ?? [];
  });
  mocks.classifyPost.mockImplementation(async ({ title }: { title: string }) => ({
    isRelevant: title.includes("good"),
    relevanceScore: 0.9,
    category: "complaint",
    categoryConfidence: 0.8,
    sentiment: "negative",
    sentimentConfidence: 0.7,
    urgency: 3,
    urgencyRaw: 2,
    audienceTag: "customer",
  }));
  mocks.generatePostReason.mockResolvedValue("Asks about the product.");
});

function post(id: string, title = `post ${id}`, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `t3_${id}`,
    title,
    selftext: "Tried Acme last week",
    subreddit: "webdev",
    author: `user_${id}`,
    score: 5,
    num_comments: 1,
    url: `https://reddit.com/${id}`,
    permalink: `/r/webdev/comments/${id}`,
    created_utc: 1_700_000_000,
    is_self: true,
    raw: {},
    ...extra,
  };
}

async function collect(runId?: string): Promise<CollectionEvent[]> {
  const events: CollectionEvent[] = [];
  for await (const event of runCollection(db, companyId, runId)) events.push(event);
  return events;
}

/** The first try of each search, leaving out any widening of an empty one. */
function pastWeekSearches() {
  return mocks.searchReddit.mock.calls
    .filter((call) => (call[1] as { timeframe: string }).timeframe === "week")
    .map((call) => call[0]);
}

async function latestRun() {
  return db.collectionRun.findFirstOrThrow({ orderBy: { startedAt: "desc" }, include: { searches: true } });
}

function search(run: Awaited<ReturnType<typeof latestRun>>, query: string) {
  return run.searches.find((row) => row.query === query)!;
}

describe("a normal run", () => {
  it("saves, classifies and credits every search", async () => {
    results = {
      '"Alpha"': [post("a1", "good one"), post("a2", "noise")],
      '"Beta"': [post("b1", "good two")],
      '"Gamma"': [],
    };

    await collect();
    const run = await latestRun();

    expect(run).toMatchObject({
      status: "completed",
      totalFetched: 3,
      totalNew: 3,
      totalClassified: 3,
      totalRelevant: 2,
      totalFiltered: 1,
    });
    expect(search(run, '"Alpha"')).toMatchObject({
      status: "done",
      fetchedCount: 2,
      newCount: 2,
      relevantCount: 1,
      filteredCount: 1,
    });
    expect(search(run, '"Beta"')).toMatchObject({ relevantCount: 1, filteredCount: 0 });
    expect(search(run, '"Gamma"')).toMatchObject({ status: "done", fetchedCount: 0 });

    const posts = await db.redditPost.findMany({ orderBy: { redditId: "asc" } });
    expect(posts.map((p) => [p.redditId, p.status, p.isRelevant])).toEqual([
      ["a1", "new", true],
      ["a2", "filtered", false],
      ["b1", "new", true],
    ]);
    // One-liners only for relevant posts.
    expect(posts.filter((p) => p.reason).map((p) => p.redditId)).toEqual(["a1", "b1"]);
    expect(posts.find((p) => p.redditId === "a2")).toMatchObject({
      urgency: null,
      category: null,
      sentiment: null,
      audienceTag: null,
    });
    expect(posts.find((p) => p.redditId === "a1")?.urgency).toBe(3);
    expect(mocks.generatePostReason).toHaveBeenCalledTimes(2);
  });

  it("shows a clear match that names no brand or product", async () => {
    results = { '"Alpha"': [post("a1", "good one", { selftext: "nothing specific here" })] };
    await collect();

    expect(await db.redditPost.findFirstOrThrow()).toMatchObject({ isRelevant: true, status: "new" });
  });

  it("holds an unsure score for review, with its labels and reason", async () => {
    mocks.classifyPost.mockResolvedValueOnce({
      isRelevant: true,
      relevanceScore: 0.58,
      category: "complaint",
      categoryConfidence: 0.8,
      sentiment: "negative",
      sentimentConfidence: 0.7,
      urgency: 3,
      urgencyRaw: 2,
      audienceTag: "competitor_customer",
    });
    results = { '"Alpha"': [post("a1", "a costly license")] };
    await collect();

    expect(await db.redditPost.findFirstOrThrow()).toMatchObject({
      isRelevant: true,
      status: "review",
      audienceTag: "competitor_customer",
      reason: "Asks about the product.",
    });
    const log = await db.classificationLog.findFirstOrThrow();
    expect(JSON.parse(log.answersJson)).toMatchObject({ verdict: "review", borderline: true });
  });

  it("holds a post that clearly is not what they asked to find", async () => {
    mocks.classifyPost.mockResolvedValueOnce({
      isRelevant: true,
      relevanceScore: 0.9,
      relevanceScores: { about_market: 0.9, matches_request: 0.05, promotional: 0 },
      category: "other",
      categoryConfidence: 0.8,
      sentiment: "neutral",
      sentimentConfidence: 0.7,
      urgency: 2,
      urgencyRaw: 1,
      audienceTag: "potential_customer",
    });
    results = { '"Alpha"': [post("a1", "off request")] };
    await collect();

    expect(await db.redditPost.findFirstOrThrow()).toMatchObject({ isRelevant: true, status: "review" });
  });

  it("sends comments, votes, and age to the classifier", async () => {
    results = { '"Alpha"': [post("a1", "good one", { num_comments: 39, score: 4 })] };
    await collect();

    expect(mocks.classifyPost.mock.calls[0]![0]).toMatchObject({
      numComments: 39,
      redditScore: 4,
      postedAt: new Date(1_700_000_000_000),
    });
  });

  it("logs every decision with the score and the search that found it", async () => {
    results = { '"Alpha"': [post("a1", "good one"), post("a2", "noise")] };
    await collect();

    const logs = await db.classificationLog.findMany({ include: { post: true } });
    expect(logs).toHaveLength(2);
    const byPost = Object.fromEntries(logs.map((log) => [log.post.redditId, log]));
    expect(byPost.a1).toMatchObject({ isRelevant: true, relevanceScore: 0.9, companyId });
    expect(byPost.a2).toMatchObject({ isRelevant: false, reason: null });
    expect(byPost.a1!.runId).toBeTruthy();
  });

  it("logs a failed classification with its error", async () => {
    mocks.classifyPost.mockRejectedValueOnce(new Error("Jev timeout"));
    results = { '"Alpha"': [post("a1", "good")] };
    await collect();

    const log = await db.classificationLog.findFirstOrThrow();
    expect(log.error).toContain("Jev timeout");
    expect(log.isRelevant).toBeNull();
  });

  it("a post another session saved is still new for this session", async () => {
    const other = await seedCompany(db, ['"Alpha"']);
    results = { '"Alpha"': [post("a1", "good")] };
    for await (const _ of runCollection(db, other.id)) void _;

    await collect();

    expect(await db.redditPost.count({ where: { redditId: "a1" } })).toBe(2);
    expect(await db.redditPost.count({ where: { companyId } })).toBe(1);
  });

  it("tags every saved post with the search that found it", async () => {
    results = { '"Beta"': [post("b1", "good")] };
    await collect();
    const saved = await db.redditPost.findFirstOrThrow();
    expect(saved.matchedQuery).toBe('"Beta"');
  });
});

describe("duplicates", () => {
  it("treats one author's post shared across subreddits as a single post", async () => {
    results = {
      '"Alpha"': [
        post("c1", "good shared post", { author: "same_author", subreddit: "mechanics" }),
        post("c2", "Good Shared Post", { author: "same_author", subreddit: "serviceadvisors" }),
        post("c3", "good shared post", { author: "another_author" }),
      ],
    };

    await collect();

    expect((await db.redditPost.findMany({ orderBy: { redditId: "asc" } })).map((p) => p.redditId)).toEqual(["c1", "c3"]);
    expect(search(await latestRun(), '"Alpha"')).toMatchObject({ newCount: 2, duplicateCount: 1 });
  });

  it("catches a shared copy found in a later run", async () => {
    results = { '"Alpha"': [post("c1", "good shared post", { author: "same_author" })] };
    await collect();

    results = { '"Alpha"': [post("c2", "good shared post", { author: "same_author", subreddit: "other" })] };
    await collect();

    expect(await db.redditPost.count()).toBe(1);
  });

  it("does not merge posts from deleted accounts", async () => {
    results = {
      '"Alpha"': [
        post("d1", "good same title", { author: "[deleted]" }),
        post("d2", "good same title", { author: "[deleted]" }),
      ],
    };

    await collect();

    expect(await db.redditPost.count()).toBe(2);
  });

  it("a second run finds the same posts and saves nothing twice", async () => {
    results = { '"Alpha"': [post("a1", "good"), post("a2", "noise")] };
    await collect();
    const classifiedAfterFirst = mocks.classifyPost.mock.calls.length;

    await collect();
    const runs = await db.collectionRun.findMany({ orderBy: { startedAt: "desc" }, include: { searches: true } });
    const second = runs[0]!;

    expect(await db.redditPost.count()).toBe(2);
    expect(second.totalNew).toBe(0);
    expect(search(second, '"Alpha"')).toMatchObject({ fetchedCount: 2, newCount: 0, duplicateCount: 2 });
    expect(mocks.classifyPost.mock.calls.length).toBe(classifiedAfterFirst);
  });

  it("counts a post found by two searches once", async () => {
    results = { '"Alpha"': [post("p1", "good")], '"Beta"': [post("p1", "good")] };
    await collect();
    const run = await latestRun();

    expect(await db.redditPost.count()).toBe(1);
    expect(search(run, '"Alpha"')).toMatchObject({ newCount: 1, duplicateCount: 0 });
    expect(search(run, '"Beta"')).toMatchObject({ newCount: 0, duplicateCount: 1 });
  });

  it("treats a post saved by someone else mid-run as a duplicate, not an error", async () => {
    results = { '"Alpha"': [post("p1", "good")] };
    // Another worker saves the post after the duplicate check but before ours.
    const realCreate = db.redditPost.create.bind(db.redditPost);
    const spy = vi.spyOn(db.redditPost, "create").mockImplementationOnce((async (args: never) => {
      await realCreate(args);
      return realCreate(args);
    }) as never);

    await collect();
    spy.mockRestore();
    const run = await latestRun();

    expect(await db.redditPost.count()).toBe(1);
    expect(run.errorCount).toBe(0);
    expect(search(run, '"Alpha"')).toMatchObject({ status: "done", duplicateCount: 1 });
  });
});

describe("name searches", () => {
  beforeEach(async () => {
    await db.keyword.create({
      data: { companyId, type: "competitor", value: "Beta", aliases: '["Beta Co"]' },
    });
  });

  it("searches names and exact phrases across Reddit, and loose topics in the subreddits", async () => {
    await db.searchQuery.create({ data: { companyId, query: "(wall art) OR (area rug)", isCustom: false } });

    await collect();

    const scopes = Object.fromEntries(
      mocks.searchReddit.mock.calls.map(([query, options]) => [query, options.subreddits]),
    );
    expect(scopes['"Beta"']).toBeUndefined();
    expect(scopes['"Alpha"']).toBeUndefined();
    expect(scopes["(wall art) OR (area rug)"]).toEqual(["webdev"]);
  });

  it("does not pay for a subreddit search when there are no subreddits", async () => {
    await db.subreddit.deleteMany();
    await db.searchQuery.create({ data: { companyId, query: "(wall art) OR (area rug)", isCustom: false } });

    await collect();

    const searched = mocks.searchReddit.mock.calls.map(([query]) => query);
    expect(searched).toContain('"Alpha"');
    expect(searched).not.toContain("(wall art) OR (area rug)");
  });

  it("ranks every search by relevance, including the company's own name", async () => {
    await db.keyword.create({ data: { companyId, type: "brand", value: "Alpha" } });

    await collect();

    const sorts = mocks.searchReddit.mock.calls.map(([, options]) => options.sort);
    expect(new Set(sorts)).toEqual(new Set(["relevance"]));
  });

  it("ranks a title search for the company by relevance, and keeps a post in its own subreddit", async () => {
    await db.keyword.create({ data: { companyId, type: "brand", value: "Delta" } });
    await db.searchQuery.create({ data: { companyId, query: 'title:"Delta" OR subreddit:Delta', isCustom: false } });
    results = {
      'title:"Delta" OR subreddit:Delta': [
        post("d1", "good: my invoice vanished", { selftext: "", subreddit: "Delta", url: "https://example.com/x" }),
        post("d2", "good: nothing related", { selftext: "", subreddit: "other", url: "https://example.com/y" }),
      ],
    };

    await collect();

    const call = mocks.searchReddit.mock.calls.find(([query]) => String(query).startsWith("title:"))!;
    expect(call[1].sort).toBe("relevance");
    expect((await db.redditPost.findMany()).map((p) => p.redditId)).toEqual(["d1"]);
  });

  it("pauses a search that finds nothing useful, but never the company's own name", async () => {
    await db.keyword.create({ data: { companyId, type: "brand", value: "Alpha" } });
    await collect();
    await collect();
    mocks.searchReddit.mockClear();

    await collect();

    const searched = mocks.searchReddit.mock.calls.map(([query]) => query);
    expect(searched).toEqual(['"Alpha"']);
    const run = await latestRun();
    expect(search(run, '"Beta"').status).toBe("skipped");
  });

  it("does not pause a search that keeps finding useful posts", async () => {
    await collect();
    results = { '"Beta"': [post("b1", "good Beta")] };
    await collect();
    results = { '"Beta"': [post("b2", "good Beta two")] };
    mocks.searchReddit.mockClear();

    await collect();

    expect(mocks.searchReddit.mock.calls.map(([query]) => query)).toContain('"Beta"');
  });

  it("tags a post only with the names it mentions when names share a search", async () => {
    await db.keyword.create({ data: { companyId, type: "competitor", value: "Gamma" } });
    await db.searchQuery.create({ data: { companyId, query: '"Beta" OR "Gamma"', isCustom: false } });
    results = { '"Beta" OR "Gamma"': [post("m1", "good Gamma review", { selftext: "" })] };

    await collect();

    const saved = await db.redditPost.findFirstOrThrow({
      include: { postKeywords: { include: { keyword: true } } },
    });
    expect(saved.postKeywords.map((link) => link.keyword.value)).toEqual(["Gamma"]);
  });

  it("drops a post that never uses the name before it is saved or classified", async () => {
    results = {
      '"Beta"': [
        post("b1", "good Beta review", { selftext: "" }),
        post("b2", "good split name", { selftext: "We tried beta co last week" }),
        post("b3", "good but unrelated", { selftext: "Nothing to see" }),
      ],
    };

    const events = await collect();

    const saved = await db.redditPost.findMany({ orderBy: { redditId: "asc" } });
    expect(saved.map((p) => p.redditId)).toEqual(["b1", "b2"]);
    expect(mocks.classifyPost).toHaveBeenCalledTimes(2);
    expect(search(await latestRun(), '"Beta"')).toMatchObject({ fetchedCount: 3, newCount: 2 });
    expect(events.some((e) => e.type === "fetched" && /1 without the name/.test(e.message))).toBe(true);
  });

  it("keeps a potential client's post from a topic search when it names nobody", async () => {
    results = {
      '"Alpha"': [post("t1", "good: what software should I use?", { selftext: "Just opened my shop" })],
    };

    await collect();

    expect((await db.redditPost.findFirstOrThrow()).redditId).toBe("t1");
    expect(mocks.classifyPost).toHaveBeenCalledTimes(1);
  });

});

describe("widening an empty topic search", () => {
  const BUYING = " (recommend OR recommendation OR alternative OR alternatives OR switch OR switching OR best OR which OR looking)";
  const topic = `("pharmacy courier service" OR "pharmacy delivery service")${BUYING}`;
  const plain = '"pharmacy courier service" OR "pharmacy delivery service"';

  beforeEach(async () => {
    await db.searchQuery.deleteMany();
    await db.searchQuery.create({ data: { companyId, query: topic } });
    await db.subreddit.deleteMany();
  });

  /** Answers `found` only for the plain search over this window. */
  function foundOver(window: string, found: unknown[]) {
    mocks.searchReddit.mockImplementation(async (query: string, options: { timeframe: string }) =>
      query === plain && options.timeframe === window ? found : [],
    );
  }

  it("tries longer windows without the buying words, and stops at the first that finds posts", async () => {
    foundOver("month", [post("m1", "good pharmacy delivery")]);

    const events = await collect();

    expect(mocks.searchReddit.mock.calls.map((call) => [call[0], call[1].timeframe])).toEqual([
      [topic, "week"],
      [plain, "month"],
    ]);
    const row = search(await latestRun(), topic);
    expect(row).toMatchObject({ status: "done", fetchedCount: 1, newCount: 1 });
    expect((await db.redditPost.findFirstOrThrow()).matchedQuery).toBe(topic);
    expect(events.some((event) => event.message.includes("from the past month"))).toBe(true);
  });

  it("goes as far as a year, then finishes when there is still nothing", async () => {
    mocks.searchReddit.mockResolvedValue([]);

    await collect();

    expect(mocks.searchReddit.mock.calls.map((call) => call[1].timeframe)).toEqual(["week", "month", "year"]);
    expect(await latestRun()).toMatchObject({ status: "completed", errorCount: 0 });
  });

  it("looks only at the past week once the search has found something, so old posts are not paid for again", async () => {
    foundOver("year", [post("y1", "good pharmacy delivery")]);
    await collect();
    mocks.searchReddit.mockClear();

    await collect();

    expect(mocks.searchReddit.mock.calls.map((call) => call[1].timeframe)).toEqual(["week"]);
  });

  it("carries on from where it was after a rate limit, instead of using the allowance on the same steps", async () => {
    let refused = 0;
    mocks.searchReddit.mockImplementation(async (_query: string, options: { timeframe: string }) => {
      // Refuses every third request, as a small allowance does. Starting over never reached the year.
      if (options.timeframe === "year" && refused++ < 3) throw new ProviderWaitError("Limited", "rate_limit", 1);
      return options.timeframe === "year" ? [post("y1", "good pharmacy delivery")] : [];
    });

    await collect();

    expect(mocks.searchReddit.mock.calls.map((call) => call[1].timeframe)).toEqual([
      "week", "month", "year", "year", "year", "year",
    ]);
    expect(search(await latestRun(), topic)).toMatchObject({ status: "done", newCount: 1, attempts: 1, waitCount: 3 });
    expect((await latestRun()).status).toBe("completed");
  });

  it("never widens a search for a name, which has plenty of posts", async () => {
    await db.keyword.create({ data: { companyId, type: "brand", value: "Acme" } });
    await db.searchQuery.deleteMany();
    await db.searchQuery.create({ data: { companyId, query: '"Acme"' } });
    mocks.searchReddit.mockResolvedValue([]);

    await collect();

    expect(mocks.searchReddit).toHaveBeenCalledTimes(1);
  });
});

describe("other names of a keyword", () => {
  beforeEach(async () => {
    await db.searchQuery.deleteMany();
    await db.searchQuery.create({ data: { companyId, query: '"Beta" OR "BTA"' } });
    await db.keyword.create({ data: { companyId, type: "competitor", value: "Beta", aliases: '["BTA"]' } });
  });

  it("keeps a post that uses only the other name, and drops one that uses neither", async () => {
    results = {
      '"Beta" OR "BTA"': [
        post("a1", "BTA keeps crashing", { selftext: "" }),
        post("a2", "Nothing relevant here", { selftext: "" }),
      ],
    };

    await collect();

    expect((await db.redditPost.findMany()).map((row) => row.redditId)).toEqual(["a1"]);
    const row = search(await latestRun(), '"Beta" OR "BTA"');
    expect(row).toMatchObject({ fetchedCount: 2, newCount: 1 });
    expect(droppedPosts(row)).toBe(1);
  });

  it("tags that post with the keyword, and passes the other name to the classifier", async () => {
    results = { '"Beta" OR "BTA"': [post("a1", "BTA keeps crashing", { selftext: "" })] };

    await collect();

    const saved = await db.redditPost.findFirstOrThrow({ include: { postKeywords: { include: { keyword: true } } } });
    expect(saved.postKeywords.map((link) => link.keyword.value)).toEqual(["Beta"]);
    const sent = mocks.classifyPost.mock.calls[0]?.[0] as { keywords: { value: string; aliases: string }[] };
    expect(sent.keywords.find((keyword) => keyword.value === "Beta")?.aliases).toBe('["BTA"]');
  });

  it("uses a name added later on the very next run", async () => {
    await db.keyword.updateMany({ where: { value: "Beta" }, data: { aliases: '["BTA", "Beta Co"]' } });
    results = { '"Beta" OR "BTA"': [post("a1", "BTA keeps crashing", { selftext: "" })] };

    await collect();

    const sent = mocks.classifyPost.mock.calls[0]?.[0] as { keywords: { value: string; aliases: string }[] };
    expect(sent.keywords.find((keyword) => keyword.value === "Beta")?.aliases).toContain("Beta Co");
  });
});

describe("the limit on posts per search", () => {
  afterEach(() => {
    collectorConfig.maxPostsPerSearch = 100;
  });

  it("has no limit by default", async () => {
    results = { '"Alpha"': Array.from({ length: 12 }, (_, i) => post(`p${i}`, "good")) };
    await collect();
    expect(mocks.searchReddit.mock.calls[0]?.[1]).toMatchObject({ limit: 100 });
    expect(await db.redditPost.count()).toBe(12);
  });

  it("keeps only that many posts when one is set", async () => {
    collectorConfig.maxPostsPerSearch = 7;
    results = { '"Alpha"': Array.from({ length: 12 }, (_, i) => post(`p${i}`, "good")) };
    await collect();
    expect(mocks.searchReddit.mock.calls[0]?.[1]).toMatchObject({ limit: 7 });
    expect(await db.redditPost.count()).toBe(7);
    expect(search(await latestRun(), '"Alpha"')).toMatchObject({ fetchedCount: 7, newCount: 7 });
  });
});

describe("the numbers on a search", () => {
  it("adds up: fetched is new, plus duplicates, plus dropped", async () => {
    await db.keyword.create({ data: { companyId, type: "competitor", value: "Beta" } });
    const earlier = post("old", "good Beta post");
    results = { '"Alpha"': [earlier] };
    await collect();

    results = {
      '"Beta"': [
        earlier,
        post("n1", "good Beta one", { selftext: "" }),
        post("n2", "good Beta two", { selftext: "" }),
        post("x1", "nothing about it", { selftext: "" }),
        post("x2", "also nothing", { selftext: "" }),
      ],
    };
    await collect();

    const row = search(await latestRun(), '"Beta"');
    expect(row).toMatchObject({ fetchedCount: 5, newCount: 2, duplicateCount: 1 });
    expect(droppedPosts(row)).toBe(2);
    expect(await db.redditPost.count({ where: { redditId: { in: ["x1", "x2"] } } })).toBe(0);
  });

  it("never shows a negative number", () => {
    expect(droppedPosts({ fetchedCount: 0, newCount: 1, duplicateCount: 0 })).toBe(0);
  });
});

describe("author profiles", () => {
  const profile = (username: string) => ({
    username,
    fullname: null,
    displayName: "A Person",
    linkKarma: 1,
    commentKarma: 2,
    awardeeKarma: 0,
    awarderKarma: 0,
    totalKarma: 3,
    createdUtc: 1_600_000_000,
    isGold: false,
    isEmployee: false,
    isMod: false,
    verified: true,
    hasVerifiedEmail: true,
    iconUrl: "https://i.redd.it/a.png",
    raw: { name: username },
  });

  beforeEach(() => {
    mocks.getRedditUser.mockImplementation(async (username: string) => profile(username));
  });

  it("saves the profile and links it to the relevant post", async () => {
    results = { '"Alpha"': [post("a1", "good")] };
    await collect();

    const saved = await db.redditPost.findFirstOrThrow({ include: { authorProfile: true } });
    expect(saved.authorProfile).toMatchObject({ username: "user_a1", displayName: "A Person", iconUrl: "https://i.redd.it/a.png" });
  });

  it("pays nothing for the author of a post that did not pass the filter", async () => {
    results = { '"Alpha"': [post("a1", "noise")] };
    await collect();
    expect(mocks.getRedditUser).not.toHaveBeenCalled();
  });

  it("looks up one username once, across posts and runs", async () => {
    const author = { author: "same_person" };
    results = {
      '"Alpha"': [post("a1", "good one", author)],
      '"Beta"': [post("b1", "good two", author)],
    };
    await collect();
    results = { '"Gamma"': [post("g1", "good three", author)] };
    await collect();

    expect(mocks.getRedditUser).toHaveBeenCalledTimes(1);
    expect(await db.redditPost.count({ where: { authorProfileId: null } })).toBe(0);
  });

  it("never looks up a deleted user", async () => {
    results = { '"Alpha"': [post("a1", "good", { author: "[deleted]" })] };
    await collect();
    expect(mocks.getRedditUser).not.toHaveBeenCalled();
  });

  it("remembers a user that does not exist instead of paying again", async () => {
    mocks.getRedditUser.mockResolvedValue(null);
    results = { '"Alpha"': [post("a1", "good")] };
    await collect();
    results = { '"Beta"': [post("b1", "good", { author: "user_a1" })] };
    await collect();

    expect(mocks.getRedditUser).toHaveBeenCalledTimes(1);
  });

  it("starts lookups only after the searches finish", async () => {
    results = { '"Alpha"': [post("a1", "good")], '"Beta"': [post("b1", "good")] };
    const order: string[] = [];
    const search = mocks.searchReddit.getMockImplementation()!;
    mocks.searchReddit.mockImplementation(async (...args: unknown[]) => {
      order.push("search");
      return search(...args);
    });
    mocks.getRedditUser.mockImplementation(async (username: string) => {
      order.push("lookup");
      return profile(username);
    });

    await collect();

    expect(order.lastIndexOf("search")).toBeLessThan(order.indexOf("lookup"));
  });

  it("stops at a limit, keeps the run healthy, and tries again next run", async () => {
    results = { '"Alpha"': [post("a1", "good")], '"Beta"': [post("b1", "good")] };
    mocks.getRedditUser.mockRejectedValue(new ProviderWaitError("Limited", "rate_limit", 60_000));

    await collect();

    expect(mocks.getRedditUser).toHaveBeenCalledTimes(1);
    expect(await latestRun()).toMatchObject({ status: "completed", errorCount: 0 });

    mocks.getRedditUser.mockImplementation(async (username: string) => profile(username));
    await collect();
    expect(await db.redditPost.count({ where: { authorProfileId: null } })).toBe(0);
  });

  it("waits out a short limit and carries on, so a few requests at a time is not a problem", async () => {
    results = { '"Alpha"': [post("a1", "good"), post("a2", "good")] };
    mocks.getRedditUser.mockRejectedValueOnce(new ProviderWaitError("Limited", "rate_limit", 5));

    await collect();

    expect(await db.redditPost.count({ where: { authorProfileId: null } })).toBe(0);
    expect(await latestRun()).toMatchObject({ status: "completed", errorCount: 0 });
  });

  it("sends no lookups with the setting off, but still uses a saved profile", async () => {
    await db.appSettings.create({ data: { id: "default", authorLookupsEnabled: false } });
    await db.redditAuthor.create({ data: { username: "known", displayName: "Known", fetchedAt: new Date() } });
    results = { '"Alpha"': [post("a1", "good"), post("a2", "good", { author: "known" })] };

    await collect();

    expect(mocks.getRedditUser).not.toHaveBeenCalled();
    const known = await db.redditPost.findFirstOrThrow({ where: { author: "known" }, include: { authorProfile: true } });
    expect(known.authorProfile?.displayName).toBe("Known");
    expect(await db.redditPost.count({ where: { authorProfileId: null } })).toBe(1);
  });

  it("caps paid lookups in one run and fills in the rest later", async () => {
    await db.appSettings.create({ data: { id: "default", authorLookupsPerRun: 1 } });
    results = { '"Alpha"': [post("a1", "good"), post("a2", "good")] };

    await collect();
    expect(mocks.getRedditUser).toHaveBeenCalledTimes(1);

    await collect();
    expect(mocks.getRedditUser).toHaveBeenCalledTimes(2);
  });
});

describe("classification running alongside the searches", () => {
  function deferred() {
    let release!: () => void;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { done, release };
  }

  const relevant = {
    isRelevant: true,
    relevanceScore: 0.9,
    category: "complaint",
    categoryConfidence: 0.8,
    sentiment: "negative",
    sentimentConfidence: 0.7,
    urgency: 3,
    urgencyRaw: 2,
    audienceTag: "customer",
  };

  it("classifies several posts at the same time", async () => {
    collectorConfig.classifyConcurrency = 4;
    results = { '"Alpha"': Array.from({ length: 8 }, (_, i) => post(`p${i}`, "good")) };
    let running = 0;
    let most = 0;
    const full = deferred();
    mocks.classifyPost.mockImplementation(async () => {
      most = Math.max(most, ++running);
      if (running === 4) full.release();
      // Holds each call until four overlap, or long enough to show they never will.
      await Promise.race([full.done, new Promise((resolve) => setTimeout(resolve, 2000))]);
      running--;
      return relevant;
    });

    await collect();

    expect(most).toBe(4);
    const run = await latestRun();
    expect(run).toMatchObject({ status: "completed", totalClassified: 8, totalRelevant: 8 });
    expect(await db.redditPost.count({ where: { status: "new" } })).toBe(8);
    expect(search(run, '"Alpha"').relevantCount).toBe(8);
  });

  it("classifies a saved post while a later search is still running", async () => {
    results = { '"Alpha"': [post("a1", "good")], '"Gamma"': [post("g1", "good")] };
    const classified = deferred();
    const search2 = mocks.searchReddit.getMockImplementation()!;
    mocks.searchReddit.mockImplementation(async (query: string, ...rest: unknown[]) => {
      // This search does not answer until the first search's post has been classified.
      if (query === '"Beta"') await classified.done;
      return search2(query, ...rest);
    });
    mocks.classifyPost.mockImplementation(async () => {
      classified.release();
      return relevant;
    });

    await collect();

    expect((await latestRun()).status).toBe("completed");
    expect(await db.redditPost.count({ where: { status: "new" } })).toBe(2);
  });

  it("keeps classifying while the searches wait out a rate limit", async () => {
    results = { '"Beta"': [] };
    const run = await db.collectionRun.create({ data: { companyId, status: "running" } });
    await ensureSearchJobs(db, run.id, companyId, ['"Beta"'], []);
    await db.redditPost.create({
      data: {
        companyId, redditId: "saved", title: "good saved", subreddit: "webdev", author: "u", url: "u",
        permalink: "p", redditCreatedAt: new Date(), matchedQuery: '"Beta"',
      },
    });
    let classifiedWhileHeld = false;
    mocks.searchReddit.mockImplementationOnce(async () => {
      throw new ProviderWaitError("Limited", "rate_limit", 500);
    });
    mocks.classifyPost.mockImplementation(async () => {
      // Answers only once the searches are held, so this proves the two do not block each other.
      await vi.waitFor(async () => {
        const held = await db.collectionRun.findUniqueOrThrow({ where: { id: run.id } });
        expect(held.waitingUntil).not.toBeNull();
      }, { timeout: 400, interval: 5 });
      classifiedWhileHeld = true;
      return relevant;
    });

    await collect(run.id);

    expect(classifiedWhileHeld).toBe(true);
    expect(await latestRun()).toMatchObject({ status: "completed", errorCount: 0 });
  });

  describe("when one post is rate limited", () => {
    const limited = (retryAfterMs: number) =>
      Object.assign(new Error("Too many requests"), { status: 429, retryAfterMs });

    beforeEach(() => {
      collectorConfig.classifyConcurrency = 3;
    });

    it("delays only that post, and the others carry on", async () => {
      results = { '"Alpha"': [post("slow", "good slow"), post("b", "good b"), post("c", "good c")] };
      const finishedFirst: string[] = [];
      let refused = false;
      mocks.classifyPost.mockImplementation(async ({ title }: { title: string }) => {
        if (title === "good slow" && !refused) {
          refused = true;
          throw limited(40);
        }
        finishedFirst.push(title);
        return relevant;
      });

      const events = await collect();

      expect(finishedFirst.at(-1)).toBe("good slow");
      expect(finishedFirst.slice(0, 2).sort()).toEqual(["good b", "good c"]);
      const saved = await db.redditPost.findFirstOrThrow({ where: { redditId: "slow" } });
      expect(saved).toMatchObject({ status: "new", classifyAttempts: 0, classifyRetryAt: null });
      expect(events.some((event) => event.type === "post_waiting")).toBe(true);
      expect(events.some((event) => event.type === "error")).toBe(false);
      expect(await latestRun()).toMatchObject({ status: "completed", errorCount: 0, totalClassified: 3 });
    });

    it("does not try the post again before its wait is over", async () => {
      results = { '"Alpha"': [post("slow", "good")] };
      const tries: number[] = [];
      mocks.classifyPost.mockImplementation(async () => {
        tries.push(Date.now());
        if (tries.length === 1) throw limited(150);
        return relevant;
      });

      await collect();

      expect(tries).toHaveLength(2);
      expect(tries[1]! - tries[0]!).toBeGreaterThanOrEqual(140);
    });

    it("does not let a limited post count towards the failure streak", async () => {
      results = { '"Alpha"': Array.from({ length: MAX_CONSECUTIVE_CLASSIFY_FAILURES + 2 }, (_, i) => post(`p${i}`, "good")) };
      let refused = 0;
      mocks.classifyPost.mockImplementation(async () => {
        if (refused++ < MAX_CONSECUTIVE_CLASSIFY_FAILURES + 2) throw limited(5);
        return relevant;
      });

      const events = await collect();

      expect(events.some((event) => event.type === "error")).toBe(false);
      expect(await db.redditPost.count({ where: { status: "new" } })).toBe(MAX_CONSECUTIVE_CLASSIFY_FAILURES + 2);
    });

    it("leaves a post that stays limited for the next run, without marking it failed", async () => {
      results = { '"Alpha"': [post("slow", "good")] };
      mocks.classifyPost.mockRejectedValue(limited(1));

      await collect();

      expect(mocks.classifyPost).toHaveBeenCalledTimes(6);
      expect(await db.redditPost.findFirstOrThrow()).toMatchObject({ status: "pending", classifyAttempts: 0 });
      expect(await latestRun()).toMatchObject({ status: "completed", errorCount: 0 });
    });

    it("does not hold the run open for a very long wait", async () => {
      results = { '"Alpha"': [post("slow", "good")] };
      mocks.classifyPost.mockRejectedValue(limited(3_600_000));

      await collect();

      expect(mocks.classifyPost).toHaveBeenCalledTimes(1);
      expect((await db.redditPost.findFirstOrThrow()).classifyRetryAt).not.toBeNull();
      expect((await latestRun()).status).toBe("completed");
    });

    it("respects that wait on the next run", async () => {
      results = { '"Alpha"': [post("slow", "good")] };
      mocks.classifyPost.mockRejectedValue(limited(3_600_000));
      await collect();
      mocks.classifyPost.mockClear();
      mocks.classifyPost.mockResolvedValue(relevant);

      await collect();

      expect(mocks.classifyPost).not.toHaveBeenCalled();
    });

    it("waits for a real summary instead of saving a plain label", async () => {
      results = { '"Alpha"': [post("slow", "good")] };
      mocks.generatePostReason.mockRejectedValueOnce(limited(5));

      await collect();

      expect(await db.redditPost.findFirstOrThrow()).toMatchObject({
        status: "new",
        reason: "Asks about the product.",
        classifyAttempts: 0,
      });
    });
  });

  it("a real failure uses up only that post's attempts", async () => {
    collectorConfig.classifyConcurrency = 3;
    results = { '"Alpha"': [post("bad", "good bad"), post("b", "good b"), post("c", "good c")] };
    mocks.classifyPost.mockImplementation(async ({ title }: { title: string }) => {
      if (title === "good bad") throw new Error("Malformed");
      return relevant;
    });

    await collect();

    expect(await db.redditPost.findFirstOrThrow({ where: { redditId: "bad" } })).toMatchObject({ status: "pending", classifyAttempts: 1 });
    expect(await db.redditPost.count({ where: { status: "new" } })).toBe(2);
    expect(mocks.classifyPost).toHaveBeenCalledTimes(3);
  });

  it("finishes the searches even when classification stops", async () => {
    mocks.classifyPost.mockRejectedValue(new Error("Jev is down"));
    results = {
      '"Alpha"': Array.from({ length: MAX_CONSECUTIVE_CLASSIFY_FAILURES + 1 }, (_, i) => post(`a${i}`, "good")),
      '"Gamma"': [post("g1", "good")],
    };

    await collect();

    const run = await latestRun();
    expect(run.searches.every((row) => row.status === "done")).toBe(true);
    expect(await db.redditPost.count({ where: { redditId: "g1" } })).toBe(1);
  });
});

describe("posts found by more than one search", () => {
  beforeEach(async () => {
    await db.keyword.create({ data: { companyId, type: "competitor", value: "Beta" } });
  });

  it("credits and tags every search in the same run", async () => {
    const both = post("p1", "good Beta and Alpha");
    results = { '"Alpha"': [both], '"Beta"': [both] };

    await collect();
    const run = await latestRun();
    const saved = await db.redditPost.findFirstOrThrow({ include: { postKeywords: { include: { keyword: true } } } });

    expect(await db.redditPost.count()).toBe(1);
    expect(JSON.parse(saved.matchedQueries)).toEqual(['"Alpha"', '"Beta"']);
    expect(saved.postKeywords.map((link) => link.keyword.value)).toContain("Beta");
    expect(search(run, '"Alpha"')).toMatchObject({ newCount: 1, relevantCount: 1 });
    expect(search(run, '"Beta"')).toMatchObject({ duplicateCount: 1, relevantCount: 1 });
  });

  it("credits a later run's search once for a post already classified", async () => {
    const both = post("p1", "good Beta and Alpha");
    results = { '"Alpha"': [both] };
    await collect();

    results = { '"Beta"': [both] };
    await collect();
    expect(search(await latestRun(), '"Beta"')).toMatchObject({ relevantCount: 1 });

    await collect();
    expect(search(await latestRun(), '"Beta"')).toMatchObject({ relevantCount: 0 });
    expect(mocks.classifyPost).toHaveBeenCalledTimes(1);
  });
});

describe("failures", () => {
  it("one failing search does not stop the others", async () => {
    results = {
      '"Alpha"': [post("a1", "good")],
      '"Beta"': new Error("ScrapeBadger 500"),
      '"Gamma"': [post("g1", "good")],
    };
    await collect();
    const run = await latestRun();

    expect(run.status).toBe("completed");
    expect(search(run, '"Beta"')).toMatchObject({ status: "failed", error: "ScrapeBadger 500" });
    expect(search(run, '"Alpha"').status).toBe("done");
    expect(search(run, '"Gamma"').status).toBe("done");
    expect(run.errorCount).toBe(1);
    expect(await db.redditPost.count()).toBe(2);
  });

  it("marks the run failed when every search failed", async () => {
    results = {
      '"Alpha"': new Error("down"),
      '"Beta"': new Error("down"),
      '"Gamma"': new Error("down"),
    };
    const events = await collect();
    const run = await latestRun();

    expect(run.status).toBe("failed");
    expect(events.at(-1)).toMatchObject({ type: "error" });
    expect(events.some((e) => e.type === "completed")).toBe(false);
  });

  it("one malformed post does not lose the rest of its search", async () => {
    results = {
      '"Alpha"': [
        post("ok1", "good"),
        post("bad", "good", { permalink: undefined }),
        post("ok2", "good"),
      ],
    };
    const events = await collect();
    const run = await latestRun();

    expect((await db.redditPost.findMany()).map((p) => p.redditId).sort()).toEqual(["ok1", "ok2"]);
    expect(search(run, '"Alpha"')).toMatchObject({ status: "done", fetchedCount: 3, newCount: 2 });
    expect(run.errorCount).toBe(1);
    expect(events.some((e) => e.type === "error" && /could not be saved/.test(e.error))).toBe(true);
  });

  it("fails cleanly when there are no searches", async () => {
    await db.searchQuery.deleteMany();
    const events = await collect();
    expect((await latestRun()).status).toBe("failed");
    expect(events[0]).toMatchObject({ type: "error" });
  });

  it("fails cleanly for a missing company", async () => {
    const events: CollectionEvent[] = [];
    for await (const event of runCollection(db, "missing")) events.push(event);
    expect(events).toEqual([expect.objectContaining({ type: "error" })]);
  });
});

describe("when the source turns the queue away", () => {
  const limited = () => new ProviderWaitError("Rate limited (429).", "rate_limit", 30);

  /** The search throws these errors in order, then answers from `results`. */
  function refuse(query: string, ...errors: Error[]) {
    const fallback = mocks.searchReddit.getMockImplementation()!;
    mocks.searchReddit.mockImplementation(async (asked: string, ...rest: unknown[]) => {
      if (asked === query && errors.length > 0) throw errors.shift();
      return fallback(asked, ...rest);
    });
  }

  it("waits, then fetches every search with none missed", async () => {
    results = {
      '"Alpha"': [post("a1", "good")],
      '"Beta"': [post("b1", "good")],
      '"Gamma"': [post("g1", "good")],
    };
    refuse('"Beta"', limited(), limited());

    const events = await collect();
    const run = await latestRun();

    expect(run).toMatchObject({ status: "completed", errorCount: 0, totalNew: 3, waitingUntil: null, waitReason: null });
    expect(search(run, '"Beta"')).toMatchObject({ status: "done", attempts: 1, waitCount: 2, error: null });
    expect(await db.redditPost.count()).toBe(3);
    expect(events.filter((event) => event.type === "waiting")).toHaveLength(2);
    expect(events.filter((event) => event.type === "resumed")).toHaveLength(2);
  });

  it("starts no other search during the wait", async () => {
    refuse('"Alpha"', limited());

    await collect();

    expect(pastWeekSearches()).toEqual(['"Alpha"', '"Alpha"', '"Beta"', '"Gamma"']);
  });

  it("does not call the search queue's waiting a failure", async () => {
    refuse('"Alpha"', limited());
    const events = await collect();
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("asks the source to report limits at once", async () => {
    await collect();
    expect(mocks.searchReddit.mock.calls[0]?.[1]).toMatchObject({ retryThrottles: false });
  });

  it("honours a wait saved before a restart", async () => {
    const run = await db.collectionRun.create({ data: { companyId, status: "running" } });
    await ensureSearchJobs(db, run.id, companyId, ['"Alpha"'], []);
    const job = await claimNextSearch(db, run.id);
    await db.collectionSearch.update({ where: { id: job!.id }, data: { status: "waiting", attempts: 0 } });
    const until = new Date(Date.now() + 150);
    await db.collectionRun.update({ where: { id: run.id }, data: { waitingUntil: until, waitReason: "Limited" } });
    await settleInterruptedRun(db, run.id);
    let searchedAt = 0;
    mocks.searchReddit.mockImplementation(async () => {
      searchedAt = Date.now();
      return [];
    });

    await collect(run.id);

    expect(searchedAt).toBeGreaterThanOrEqual(until.getTime());
    expect(search(await latestRun(), '"Alpha"').status).toBe("done");
  });

  it("marks a search failed after repeated outages and finishes the rest", async () => {
    results = { '"Beta"': [post("b1", "good")] };
    const outage = () => new ProviderWaitError("Unavailable (500).", "outage", 1);
    refuse('"Alpha"', ...Array.from({ length: MAX_OUTAGE_TRIES + 2 }, outage));

    await collect();
    const run = await latestRun();

    expect(run.status).toBe("completed");
    expect(search(run, '"Alpha"')).toMatchObject({ status: "failed", outageCount: MAX_OUTAGE_TRIES - 1 });
    expect(search(run, '"Beta"').status).toBe("done");
    expect(mocks.searchReddit.mock.calls.filter((call) => call[0] === '"Alpha"')).toHaveLength(MAX_OUTAGE_TRIES);
  });

  it("keeps unfinished searches on the queue after an unexpected error", async () => {
    const run = await db.collectionRun.create({ data: { companyId, status: "running" } });
    await ensureSearchJobs(db, run.id, companyId, ['"Alpha"', '"Beta"'], []);
    const spy = vi.spyOn(db.collectionSearch, "findFirst").mockRejectedValueOnce(new Error("database is locked"));

    const events = await collect(run.id);
    spy.mockRestore();

    expect(events.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("stay on the queue") });
    expect(await settleInterruptedRun(db, run.id)).toBe("queued");
  });
});

describe("resume", () => {
  it("does not fetch a finished search again", async () => {
    const run = await db.collectionRun.create({ data: { companyId, status: "running" } });
    await ensureSearchJobs(db, run.id, companyId, ['"Alpha"', '"Beta"', '"Gamma"'], []);
    const first = await claimNextSearch(db, run.id);
    await completeSearch(db, first!.id, { fetched: 4, fresh: 4, duplicates: 0 });

    await collect(run.id);

    expect(pastWeekSearches()).toEqual(['"Beta"', '"Gamma"']);
    const finished = await latestRun();
    expect(finished.status).toBe("completed");
    expect(search(finished, '"Alpha"')).toMatchObject({ status: "done", fetchedCount: 4 });
  });

  it("keeps the totals saved before the stop", async () => {
    const run = await db.collectionRun.create({
      data: { companyId, status: "running", totalFetched: 10, totalNew: 7 },
    });
    results = { '"Alpha"': [post("a1", "good")] };

    await collect(run.id);

    expect(await db.collectionRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      totalFetched: 11,
      totalNew: 8,
    });
  });
});

describe("classification failures", () => {
  beforeEach(() => {
    mocks.classifyPost.mockRejectedValue(new Error("OpenAI 500"));
  });

  it("retries a post on later runs and gives up after the limit", async () => {
    results = { '"Alpha"': [post("p1", "good")] };

    for (let attempt = 1; attempt <= MAX_CLASSIFY_ATTEMPTS; attempt++) {
      await collect();
      const saved = await db.redditPost.findFirstOrThrow();
      expect(saved.classifyAttempts).toBe(attempt);
      expect(saved.status).toBe(attempt === MAX_CLASSIFY_ATTEMPTS ? "error" : "pending");
    }

    const callsBefore = mocks.classifyPost.mock.calls.length;
    await collect();
    expect(mocks.classifyPost.mock.calls.length).toBe(callsBefore);
  });

  it("stops after several failures in a row and keeps the rest pending", async () => {
    const total = MAX_CONSECUTIVE_CLASSIFY_FAILURES + 3;
    results = { '"Alpha"': Array.from({ length: total }, (_, i) => post(`p${i}`, "good")) };

    const events = await collect();

    expect(mocks.classifyPost).toHaveBeenCalledTimes(MAX_CONSECUTIVE_CLASSIFY_FAILURES);
    const untouched = await db.redditPost.count({ where: { status: "pending", classifyAttempts: 0 } });
    expect(untouched).toBe(3);
    expect(events.some((e) => e.type === "error" && /paused/i.test(e.message))).toBe(true);
  });

  it("a success resets the failure streak", async () => {
    let calls = 0;
    mocks.classifyPost.mockImplementation(async () => {
      calls++;
      if (calls % 2 === 1) throw new Error("flaky");
      return {
        isRelevant: false,
        relevanceScore: 0.1,
        category: "other",
        categoryConfidence: 0.5,
        sentiment: "neutral",
        sentimentConfidence: 0.5,
        urgency: 1,
        urgencyRaw: 0,
        audienceTag: "potential_customer",
      };
    });
    results = { '"Alpha"': Array.from({ length: 10 }, (_, i) => post(`p${i}`)) };

    await collect();

    expect(mocks.classifyPost).toHaveBeenCalledTimes(10);
  });

  it("counts a post only after it is saved", async () => {
    mocks.classifyPost.mockResolvedValue({
      isRelevant: true,
      relevanceScore: 0.9,
      category: "complaint",
      categoryConfidence: 0.8,
      sentiment: "negative",
      sentimentConfidence: 0.7,
      urgency: 3,
      urgencyRaw: 2,
      audienceTag: "customer",
    });
    mocks.generatePostReason.mockRejectedValue(new Error("reason failed"));
    results = { '"Alpha"': [post("p1")] };

    await collect();
    const run = await latestRun();

    expect(run.totalClassified).toBe(0);
    expect(run.totalRelevant).toBe(0);
    expect((await db.redditPost.findFirstOrThrow()).status).toBe("pending");
  });
});
