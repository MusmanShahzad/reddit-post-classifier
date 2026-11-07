import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// getSchedule starts the real scheduler, which would tick against the real database.
vi.mock("@/server/services/scheduler", () => ({ startScheduler: () => undefined }));
const enqueueCollection = vi.hoisted(() => vi.fn(async () => ({ ok: true, runId: "run", queued: false })));
vi.mock("@/server/services/collection-runs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/collection-runs")>()),
  enqueueCollection,
}));
vi.mock("@/server/services/classifier", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/classifier")>()),
  readGoals: async () => ["own_feedback"],
}));

import { createCallerFactory } from "@/server/api/trpc";
import { SESSION_HEADER, sessionIdFromPath } from "@/lib/session-header";
import { collectorRouter } from "@/server/api/routers/collector";
import { onboardingRouter } from "@/server/api/routers/onboarding";
import { postRouter } from "@/server/api/routers/post";
import { sessionRouter } from "@/server/api/routers/session";
import { settingsRouter } from "@/server/api/routers/settings";
import { createTestDb, seedCompany, type TestDb } from "./helpers/test-db";

let handle: Awaited<ReturnType<typeof createTestDb>>;
let db: TestDb;
let companyId: string;

const ctx = (headers: Record<string, string> = {}) => ({ db, headers: new Headers(headers) });
const post = () => createCallerFactory(postRouter)(ctx());
const settings = () => createCallerFactory(settingsRouter)(ctx());
const collector = () => createCallerFactory(collectorRouter)(ctx());
const session = () => createCallerFactory(sessionRouter)(ctx());
const onboarding = () => createCallerFactory(onboardingRouter)(ctx());

beforeAll(async () => {
  handle = await createTestDb();
  db = handle.db;
}, 120_000);

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await handle.reset();
  await db.appSettings.deleteMany();
  companyId = (await seedCompany(db)).id;
  await db.appSettings.create({
    data: { id: "default", activeCompanyId: companyId, isOnboardingComplete: true },
  });
});

async function savePost(redditId: string, data: Record<string, unknown> = {}) {
  return db.redditPost.create({
    data: {
      companyId,
      redditId,
      title: `title ${redditId}`,
      body: "",
      subreddit: "webdev",
      author: "someone",
      url: "https://reddit.com/x",
      permalink: "https://reddit.com/x",
      redditScore: 1,
      numComments: 0,
      isSelf: true,
      rawJson: "{}",
      redditCreatedAt: new Date(),
      ...data,
    },
  });
}

describe("the first search of a new session", () => {
  const brief = {
    product: "standing desks",
    keepWhen: "bad reviews",
    brandKeywords: [{ value: "Deskly", aliases: [] }],
    competitorKeywords: [],
    topicKeywords: [],
    subreddits: [],
  };

  beforeEach(() => enqueueCollection.mockClear());

  it("starts as soon as the session is saved", async () => {
    const { companyId: created } = await onboarding().saveConfig({ companyName: "Deskly", ...brief });
    expect(enqueueCollection).toHaveBeenCalledTimes(1);
    expect(enqueueCollection).toHaveBeenCalledWith(expect.anything(), created);
  });

  it("still starts with automatic collection switched off, because the user asked for it", async () => {
    await settings().updateSettings({ autoCollectEnabled: false });
    const { companyId: created } = await onboarding().saveConfig({ companyName: "Deskly", ...brief });
    expect(enqueueCollection).toHaveBeenCalledWith(expect.anything(), created);
  });

  it("still saves the session if the search cannot start", async () => {
    enqueueCollection.mockRejectedValueOnce(new Error("busy"));
    const { companyId: created } = await onboarding().saveConfig({ companyName: "Deskly", ...brief });
    expect(await db.company.findUnique({ where: { id: created } })).not.toBeNull();
  });
});

describe("other names for a keyword", () => {
  it("saves them and searches for them", async () => {
    const keyword = await db.keyword.create({ data: { companyId, type: "brand", value: "QuickBooks" } });

    await settings().updateKeyword({ id: keyword.id, aliases: ["Quick Books"] });

    expect((await db.keyword.findUniqueOrThrow({ where: { id: keyword.id } })).aliases).toBe('["Quick Books"]');
    const queries = await db.searchQuery.findMany({ where: { companyId } });
    expect(queries.some((row) => row.query.includes("Quick Books"))).toBe(true);
  });

  it("stops searching for a removed name", async () => {
    const keyword = await db.keyword.create({ data: { companyId, type: "brand", value: "QuickBooks", aliases: '["Quick Books"]' } });

    await settings().updateKeyword({ id: keyword.id, aliases: [] });

    const queries = await db.searchQuery.findMany({ where: { companyId } });
    expect(queries.some((row) => row.query.includes("Quick Books"))).toBe(false);
  });
});

describe("other names set during setup", () => {
  it("saves them, and searches for them, for a brand and a competitor", async () => {
    const { companyId: created } = await onboarding().saveConfig({
      companyName: "Deskly",
      product: "standing desks",
      keepWhen: "people choosing a desk",
      brandKeywords: [{ value: "Deskly", aliases: ["Desk Ly"] }],
      competitorKeywords: [{ value: "Uplift", aliases: ["Uplift Desk"] }],
      topicKeywords: [],
      subreddits: [],
    });

    const keywords = await db.keyword.findMany({ where: { companyId: created } });
    expect(keywords.find((row) => row.value === "Deskly")?.aliases).toBe('["Desk Ly"]');
    expect(keywords.find((row) => row.value === "Uplift")?.aliases).toBe('["Uplift Desk"]');
    const all = (await db.searchQuery.findMany({ where: { companyId: created } })).map((row) => row.query).join(" ");
    expect(all).toContain("Desk Ly");
  });
});

describe("what counts as relevant", () => {
  it("means the same on the dashboard and the sidebar, and held posts count on their own", async () => {
    await savePost("shown", { isRelevant: true, status: "new" });
    await savePost("done", { isRelevant: true, status: "handled" });
    await savePost("held", { isRelevant: true, status: "review", category: "complaint" });
    await savePost("gone", { isRelevant: true, status: "dismissed", category: "complaint" });
    await savePost("noise", { isRelevant: false, status: "filtered" });

    const stats = await post().getStats();
    const row = (await session().list()).sessions.find((item) => item.id === companyId)!;

    expect(stats).toMatchObject({ relevant: 2, review: 1, open: 1 });
    expect(row).toMatchObject({ relevant: 2, toCheck: 1 });
    expect(stats.categories.some((item) => item.category === "complaint")).toBe(false);
  });
});

describe("new-post badges", () => {
  const labelled = async () => {
    const { sessions } = await session().list();
    return sessions.find((row) => row.id === companyId)!;
  };

  it("counts relevant posts classified since the feed was last opened", async () => {
    const seen = new Date(Date.now() - 60_000);
    await db.company.update({ where: { id: companyId }, data: { lastSeenAt: seen } });
    await savePost("before", { isRelevant: true, status: "new", classifiedAt: new Date(seen.getTime() - 1000) });
    await savePost("after", { isRelevant: true, status: "new", classifiedAt: new Date() });
    await savePost("check", { isRelevant: true, status: "review", classifiedAt: new Date() });
    await savePost("noise", { isRelevant: false, status: "filtered", classifiedAt: new Date() });
    await savePost("gone", { isRelevant: true, status: "dismissed", classifiedAt: new Date() });
    await savePost("done", { isRelevant: true, status: "handled", classifiedAt: new Date() });

    expect((await labelled()).newPosts).toBe(2);
  });

  it("clears on opening the feed, and says when it was last opened", async () => {
    const seen = new Date(Date.now() - 60_000);
    await db.company.update({ where: { id: companyId }, data: { lastSeenAt: seen } });
    await savePost("after", { isRelevant: true, status: "new", classifiedAt: new Date() });

    const { previous } = await session().markSeen();

    expect(previous).toEqual(seen);
    expect((await labelled()).newPosts).toBe(0);
  });

  it("keeps each session's count separate", async () => {
    const other = await db.company.create({ data: { name: "Other" } });
    await savePost("theirs", { companyId: other.id, isRelevant: true, status: "new", classifiedAt: new Date() });

    await session().markSeen();

    const { sessions } = await session().list();
    expect(sessions.find((row) => row.id === other.id)?.newPosts).toBe(1);
    expect(sessions.find((row) => row.id === companyId)?.newPosts).toBe(0);
  });

  it("shows what each session's run is doing", async () => {
    expect((await labelled()).runState).toBeNull();

    const queued = await db.collectionRun.create({ data: { companyId, status: "queued" } });
    expect((await labelled()).runState).toBe("queued");

    await db.collectionRun.update({ where: { id: queued.id }, data: { status: "running" } });
    expect((await labelled()).runState).toBe("collecting");

    await db.collectionRun.update({ where: { id: queued.id }, data: { waitingUntil: new Date(Date.now() + 1000) } });
    expect((await labelled()).runState).toBe("waiting");
  });
});

describe("what the schedule collects", () => {
  it("shows an older session as scheduled only while it is open", async () => {
    const older = await db.company.create({ data: { name: "Older" } });

    const before = await session().list();
    expect(before.sessions.find((row) => row.id === older.id)?.autoCollect).toBe(false);
    expect(before.sessions.find((row) => row.id === companyId)?.autoCollect).toBe(true);
  });

  it("does not change the schedule by switching sessions", async () => {
    const older = await db.company.create({ data: { name: "Older" } });

    await session().switchTo({ id: older.id });

    const rows = await db.company.findMany({ where: { id: { in: [older.id, companyId] } } });
    expect(rows.every((row) => row.autoCollect === null)).toBe(true);
  });

  it("saves the switch for a session", async () => {
    await session().setAutoCollect({ id: companyId, enabled: false });
    expect((await session().list()).sessions.find((row) => row.id === companyId)?.autoCollect).toBe(false);
    await expect(session().setAutoCollect({ id: "missing", enabled: true })).rejects.toThrow(/not found/i);
  });
});

describe("author lookup settings", () => {
  it("saves the switch and the limit, and rejects a limit out of range", async () => {
    expect(await settings().updateSettings({ authorLookupsEnabled: false, authorLookupsPerRun: 5 })).toMatchObject({
      authorLookupsEnabled: false,
      authorLookupsPerRun: 5,
    });
    await expect(settings().updateSettings({ authorLookupsPerRun: 0 })).rejects.toThrow();
    await expect(settings().updateSettings({ authorLookupsPerRun: 201 })).rejects.toThrow();
  });
});

describe("authors and mentions", () => {
  async function addAuthor(username = "someone") {
    return db.redditAuthor.create({
      data: { username, displayName: "Sam", iconUrl: "https://i.redd.it/s.png", totalKarma: 42, fetchedAt: new Date(), rawJson: '{"secret":1}' },
    });
  }

  it("shows the picture, name, mentions and post count in the feed", async () => {
    await db.keyword.create({ data: { companyId, type: "brand", value: "Acme" } });
    await db.keyword.create({ data: { companyId, type: "competitor", value: "Rival" } });
    await db.keyword.create({ data: { companyId, type: "topic", value: "chairs" } });
    const author = await addAuthor();
    await savePost("r1", {
      isRelevant: true,
      status: "new",
      title: "Acme or chairs?",
      body: "Moved from Acme, u/helper said so. I am u/someone.",
      authorProfileId: author.id,
    });
    await savePost("r2", { isRelevant: false, status: "filtered" });
    await savePost("r3", { isRelevant: true, status: "dismissed" });
    await savePost("r4", { isRelevant: true, status: "new", author: "another" });

    const { posts } = await post().getFeed({});
    const shown = posts.find((row) => row.redditId === "r1")!;

    expect(shown.authorProfile).toEqual({ displayName: "Sam", iconUrl: "https://i.redd.it/s.png" });
    expect(shown.mentions).toEqual({ names: [{ value: "Acme", type: "brand" }], people: ["helper"] });
    expect(shown.authorPostCount).toBe(2);
    expect(posts.find((row) => row.redditId === "r4")?.authorPostCount).toBe(1);
  });

  it("opens a post with the author's other posts, leaving out dismissed ones", async () => {
    const author = await addAuthor();
    const opened = await savePost("r1", { isRelevant: true, status: "new", authorProfileId: author.id });
    await savePost("older", { isRelevant: false, status: "filtered", redditCreatedAt: new Date(Date.now() - 86_400_000) });
    await savePost("newer", { isRelevant: true, status: "handled", redditCreatedAt: new Date(Date.now() + 1000) });
    await savePost("gone", { isRelevant: true, status: "dismissed" });
    await savePost("stranger", { author: "another" });

    const detail = await post().getPostDetail({ postId: opened.id });

    expect(detail.otherPosts.map((row) => row.title)).toEqual(["title newer", "title older"]);
    expect(detail.otherPostCount).toBe(2);
    expect(detail.post.authorProfile).toMatchObject({ displayName: "Sam", totalKarma: 42 });
    expect(detail.post.authorProfile).not.toHaveProperty("rawJson");
    expect(detail.post).not.toHaveProperty("rawJson");
  });

  it("does not treat deleted users as one person", async () => {
    const opened = await savePost("r1", { author: "[deleted]" });
    await savePost("r2", { author: "[deleted]" });

    const detail = await post().getPostDetail({ postId: opened.id });
    expect(detail.otherPosts).toEqual([]);
    expect(detail.otherPostCount).toBe(0);
  });

  it("does not open a post or show history from another session", async () => {
    const other = await db.company.create({ data: { name: "Other" } });
    const foreign = await savePost("f1", { companyId: other.id });
    await expect(post().getPostDetail({ postId: foreign.id })).rejects.toThrow(/not found/i);

    const opened = await savePost("r1");
    const detail = await post().getPostDetail({ postId: opened.id });
    expect(detail.otherPosts).toEqual([]);
  });

  it("counts posts delayed by a rate limit", async () => {
    await savePost("r1", { status: "pending", classifyRetryAt: new Date(Date.now() + 60_000) });
    await savePost("r2", { status: "pending", classifyRetryAt: new Date(Date.now() - 60_000) });
    await savePost("r3", { status: "pending" });

    expect(await post().getStats()).toMatchObject({ pending: 3, rateLimited: 1 });
  });
});

describe("post.updateStatus", () => {
  it("changes a relevant post", async () => {
    const saved = await savePost("r1", { isRelevant: true, status: "new" });
    const updated = await post().updateStatus({ postId: saved.id, status: "handled" });
    expect(updated.status).toBe("handled");
  });

  it("refuses a saved not-relevant post", async () => {
    const saved = await savePost("r2", { isRelevant: false, status: "filtered" });
    await expect(post().updateStatus({ postId: saved.id, status: "new" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await db.redditPost.findUniqueOrThrow({ where: { id: saved.id } })).status).toBe("filtered");
  });

  it("reports a missing post instead of crashing", async () => {
    await expect(post().updateStatus({ postId: "nope", status: "new" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("post.markRelevant", () => {
  async function filteredPostFromSearch() {
    const run = await db.collectionRun.create({ data: { companyId, status: "completed" } });
    const row = await db.collectionSearch.create({
      data: {
        runId: run.id,
        companyId,
        query: '"Alpha"',
        status: "done",
        fetchedCount: 3,
        newCount: 3,
        filteredCount: 3,
      },
    });
    const saved = await savePost("f1", {
      isRelevant: false,
      status: "filtered",
      matchedQuery: '"Alpha"',
    });
    return { row, saved };
  }

  it("moves the post to the feed and moves the tag's count with it", async () => {
    const { row, saved } = await filteredPostFromSearch();

    const updated = await post().markRelevant({ postId: saved.id, reason: "They ask about the product" });

    expect(updated).toMatchObject({ isRelevant: true, status: "new", reason: "They ask about the product" });
    const search = await db.collectionSearch.findUniqueOrThrow({ where: { id: row.id } });
    expect(search).toMatchObject({ relevantCount: 1, filteredCount: 2 });
  });

  it("never lets a count go below zero", async () => {
    const { row, saved } = await filteredPostFromSearch();
    await db.collectionSearch.update({ where: { id: row.id }, data: { filteredCount: 0 } });

    await post().markRelevant({ postId: saved.id, reason: "They ask about the product" });

    const search = await db.collectionSearch.findUniqueOrThrow({ where: { id: row.id } });
    expect(search.filteredCount).toBe(0);
    expect(search.relevantCount).toBe(0);
  });

  it("refuses a post that is already relevant or not classified yet", async () => {
    const relevant = await savePost("m1", { isRelevant: true, status: "new" });
    const unclassified = await savePost("m2");

    await expect(
      post().markRelevant({ postId: relevant.id, reason: "Already in the feed" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      post().markRelevant({ postId: unclassified.id, reason: "Not classified yet" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("needs a real reason", async () => {
    const { saved } = await filteredPostFromSearch();
    await expect(post().markRelevant({ postId: saved.id, reason: "no" })).rejects.toThrow();
  });
});

describe("post.getFeed", () => {
  it("pages through posts with equal urgency without skipping or repeating", async () => {
    const when = new Date();
    for (let i = 0; i < 7; i++) {
      await savePost(`p${i}`, { isRelevant: true, status: "new", urgency: 3, redditCreatedAt: when });
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const result = await post().getFeed({ limit: 3, cursor });
      seen.push(...result.posts.map((p) => p.redditId));
      cursor = result.nextCursor;
      if (!cursor) break;
    }

    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });
});

describe("settings validation", () => {
  it("trims and strips r/ from a subreddit name", async () => {
    const saved = await settings().addSubreddit({ companyId, name: "  r/mechanics " });
    expect(saved.name).toBe("mechanics");
  });

  it("rejects subreddit names that cannot exist", async () => {
    for (const name of ["", "a", "has space", "bad!name", "x".repeat(30)]) {
      await expect(settings().addSubreddit({ companyId, name })).rejects.toThrow();
    }
  });

  it("rejects empty and oversized keywords and queries", async () => {
    await expect(
      settings().addKeyword({ companyId, type: "brand", value: "   " }),
    ).rejects.toThrow();
    await expect(
      settings().addKeyword({ companyId, type: "brand", value: "x".repeat(200) }),
    ).rejects.toThrow();
    await expect(settings().addCustomQuery({ companyId, query: "x".repeat(300) })).rejects.toThrow();
  });

  it("does not store the same custom query twice", async () => {
    const first = await settings().addCustomQuery({ companyId, query: '"my query"' });
    const second = await settings().addCustomQuery({ companyId, query: '  "my query"  ' });
    expect(second.id).toBe(first.id);
    expect(await db.searchQuery.count({ where: { query: '"my query"' } })).toBe(1);
  });

  it("only deletes custom queries", async () => {
    const auto = await db.searchQuery.findFirstOrThrow({ where: { isCustom: false } });
    await settings().deleteSearchQuery({ id: auto.id });
    expect(await db.searchQuery.findUnique({ where: { id: auto.id } })).not.toBeNull();

    const custom = await settings().addCustomQuery({ companyId, query: "temp" });
    await settings().deleteSearchQuery({ id: custom.id });
    expect(await db.searchQuery.findUnique({ where: { id: custom.id } })).toBeNull();
  });

  it("removing something twice does not error", async () => {
    const sub = await db.subreddit.findFirstOrThrow();
    await settings().removeSubreddit({ id: sub.id });
    await expect(settings().removeSubreddit({ id: sub.id })).resolves.toBeDefined();
  });

  it("rebuilds searches when a keyword is edited, and keeps custom queries", async () => {
    const keyword = await settings().addKeyword({ companyId, type: "brand", value: "Acme" });
    await settings().addCustomQuery({ companyId, query: "keep me" });

    await settings().updateKeyword({ id: keyword.id, value: "Zenith" });

    const queries = (await db.searchQuery.findMany({ where: { companyId } })).map((q) => q.query);
    expect(queries.some((q) => q.includes("Zenith"))).toBe(true);
    expect(queries.some((q) => q.includes("Acme"))).toBe(false);
    expect(queries).toContain("keep me");
  });

  it("reports a missing keyword on update", async () => {
    await expect(settings().updateKeyword({ id: "nope", value: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("survives a damaged aliases value", async () => {
    await db.keyword.create({
      data: { companyId, type: "brand", value: "Broken", aliases: "{not json" },
    });
    const result = await settings().getTagPerformance();
    expect(result.keywords.find((k) => k.value === "Broken")).toBeDefined();
  });

  it("saves the auto-collect switch and rejects a fractional interval", async () => {
    await settings().updateSettings({ autoCollectEnabled: false });
    expect((await settings().getSettings())?.autoCollectEnabled).toBe(false);
    await expect(settings().updateSettings({ collectionIntervalMins: 7.5 })).rejects.toThrow();
  });
});

describe("sessions", () => {
  const brief = {
    product: "standing desks",
    buyer: "people who work from home",
    keepWhen: "bad reviews of our desks",
    notAbout: "gaming chairs",
    brandKeywords: [{ value: "Deskly", aliases: [] }],
    competitorKeywords: [],
    topicKeywords: [{ value: "standing desk" }],
    subreddits: ["StandingDesk"],
  };

  describe("in two tabs", () => {
    const inTab = (id: string) => ctx({ [SESSION_HEADER]: id });

    it("answers each tab for its own session, without changing the remembered one", async () => {
      const other = await db.company.create({ data: { name: "Other co", product: "chairs", keepWhen: "reviews" } });
      await db.searchQuery.create({ data: { companyId: other.id, query: '"Other co"' } });

      const company = await createCallerFactory(settingsRouter)(inTab(other.id)).getCompany();
      const schedule = await createCallerFactory(collectorRouter)(inTab(other.id)).getSchedule();
      const remembered = await settings().getCompany();

      expect(company?.id).toBe(other.id);
      expect(schedule.searchesPerRun).toBe(1);
      expect(remembered?.id).toBe(companyId);
      expect((await session().list()).activeId).toBe(companyId);
    });

    it("uses the remembered session when a tab names one that is gone", async () => {
      const company = await createCallerFactory(settingsRouter)(inTab("deleted-session")).getCompany();
      expect(company?.id).toBe(companyId);
    });
  });

  it("reads the session from a page's address", () => {
    expect(sessionIdFromPath("/cmw2iz67k0037")).toBe("cmw2iz67k0037");
    expect(sessionIdFromPath("/")).toBeNull();
    expect(sessionIdFromPath("/a/b")).toBeNull();
  });

  it("saving onboarding creates a new session and keeps the old one", async () => {
    await onboarding().saveConfig({ companyName: "Deskly", sessionName: "Deskly bad reviews", ...brief });

    const list = await session().list();
    expect(list.sessions).toHaveLength(2);
    const created = list.sessions.find((s) => s.label === "Deskly bad reviews")!;
    expect(list.activeId).toBe(created.id);
    expect(list.sessions.some((s) => s.id === companyId)).toBe(true);
  });

  it("builds searches from the goal it read, and keeps that goal on the session", async () => {
    const { companyId: created } = await onboarding().saveConfig({
      companyName: "Deskly",
      ...brief,
      competitorKeywords: [{ value: "Uplift" }],
    });

    const saved = await db.company.findUniqueOrThrow({ where: { id: created } });
    const queries = await db.searchQuery.findMany({ where: { companyId: created } });
    expect(JSON.parse(saved.goals)).toEqual(["own_feedback"]);
    expect(queries).toHaveLength(1);
    expect(queries[0]!.query).toBe('title:"Deskly" OR subreddit:Deskly');
  });

  it("a save that fails partway leaves no empty session and keeps the active one", async () => {
    const before = await session().list();

    // The same subreddit twice breaks a unique rule after the session and keywords are written.
    await expect(
      onboarding().saveConfig({ companyName: "Deskly", ...brief, subreddits: ["StandingDesk", "StandingDesk"] }),
    ).rejects.toThrow();

    const after = await session().list();
    expect(after.sessions).toHaveLength(before.sessions.length);
    expect(after.activeId).toBe(before.activeId);
    expect(await db.company.count({ where: { name: "Deskly" } })).toBe(0);
    expect(await db.keyword.count({ where: { value: "Deskly" } })).toBe(0);
  });

  it("each session sees only its own posts", async () => {
    await savePost("shared", { isRelevant: true, status: "new" });
    const { companyId: other } = await onboarding().saveConfig({ companyName: "Deskly", ...brief });
    await db.redditPost.create({
      data: {
        companyId: other,
        redditId: "shared",
        title: "same reddit post, judged again",
        subreddit: "webdev",
        author: "someone",
        url: "https://reddit.com/x",
        permalink: "https://reddit.com/x",
        rawJson: "{}",
        redditCreatedAt: new Date(),
        isRelevant: false,
        status: "filtered",
      },
    });

    expect((await post().getFeed({})).posts).toHaveLength(0);
    expect((await post().getStats()).filtered).toBe(1);

    await session().switchTo({ id: companyId });
    expect((await post().getFeed({})).posts.map((p) => p.redditId)).toEqual(["shared"]);
    expect((await post().getStats()).total).toBe(1);
  });

  it("refuses to change a post from another session", async () => {
    const mine = await savePost("mine", { isRelevant: true, status: "new" });
    await onboarding().saveConfig({ companyName: "Deskly", ...brief });
    await expect(post().updateStatus({ postId: mine.id, status: "handled" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("deleting the active session switches to the next one, and the last one restarts onboarding", async () => {
    const { companyId: other } = await onboarding().saveConfig({ companyName: "Deskly", ...brief });
    await savePost("gone");

    await session().remove({ id: other });
    expect((await session().list()).activeId).toBe(companyId);

    await session().remove({ id: companyId });
    expect(await db.redditPost.count()).toBe(0);
    expect(await onboarding().getStatus()).toMatchObject({ isOnboardingComplete: false, activeCompanyId: null });
  });

  it("will not delete a session while it is collecting", async () => {
    await db.collectionRun.create({ data: { companyId, status: "running" } });
    await expect(session().remove({ id: companyId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("attaches the logged chat to the session it created", async () => {
    await db.chatMessage.create({
      data: { draftId: "draft-12345", role: "user", content: "We sell standing desks" },
    });
    const { companyId: created } = await onboarding().saveConfig({
      companyName: "Deskly",
      draftId: "draft-12345",
      ...brief,
    });
    const logged = await db.chatMessage.findMany({ where: { companyId: created }, orderBy: { createdAt: "asc" } });
    expect(logged.map((m) => m.role)).toEqual(["user", "system"]);
    expect(JSON.parse(logged[1]!.metadata!).config.keepWhen).toBe("bad reviews of our desks");
  });
});

describe("collector.getSchedule", () => {
  it("knows whether the scheduler will run this session", async () => {
    await db.company.update({ where: { id: companyId }, data: { autoCollect: true } });
    expect((await collector().getSchedule()).scheduled).toBe(true);

    await db.company.update({ where: { id: companyId }, data: { autoCollect: false } });
    expect((await collector().getSchedule()).scheduled).toBe(false);

    await db.company.update({ where: { id: companyId }, data: { autoCollect: true } });
    await settings().updateSettings({ autoCollectEnabled: false });
    expect((await collector().getSchedule()).scheduled).toBe(false);
  });

  it("reports the cost of a run and respects the auto switch", async () => {
    const before = await collector().getSchedule();
    expect(before).toMatchObject({ autoCollectEnabled: true, searchesPerRun: 3, creditsPerRun: 24 });

    await settings().updateSettings({ autoCollectEnabled: false, collectionIntervalMins: 60 });
    const after = await collector().getSchedule();
    expect(after).toMatchObject({ autoCollectEnabled: false, intervalMins: 60, creditsPerDay: 24 * 24 });
  });

  it("counts the next run from when the last one finished", async () => {
    const finished = new Date(Date.now() - 10 * 60_000);
    await db.collectionRun.create({
      data: {
        companyId,
        status: "completed",
        startedAt: new Date(Date.now() - 120 * 60_000),
        completedAt: finished,
      },
    });

    const schedule = await collector().getSchedule();
    expect(schedule.nextRunAt.getTime()).toBe(finished.getTime() + 30 * 60_000);
  });
});
