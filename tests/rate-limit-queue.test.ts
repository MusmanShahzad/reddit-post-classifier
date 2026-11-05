import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Runs the real worker, scheduler and ScrapeBadger code against a fake
 * ScrapeBadger, so limits arrive as real HTTP responses. No credit is spent.
 */
const shared = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/server/db", () => ({
  get db() {
    return shared.db;
  },
}));
vi.mock("@/server/services/classifier", () => ({
  classifyPost: async () => ({
    isRelevant: true,
    relevanceScore: 0.9,
    category: "complaint",
    categoryConfidence: 0.8,
    sentiment: "negative",
    sentimentConfidence: 0.7,
    urgency: 3,
    urgencyRaw: 2,
    audienceTag: "customer",
  }),
  reasonIsBacked: async () => true,
}));
vi.mock("@/server/services/openai", () => ({
  generatePostReason: async () => "Asks about the product.",
}));

import { authorConfig } from "@/server/services/authors";
import { collectorConfig } from "@/server/services/collector";
import { enqueueCollection, isCollectionActive } from "@/server/services/collection-runs";
import { useRedditProvider } from "@/server/services/reddit";
import { checkSchedule } from "@/server/services/scheduler";
import { ensureSearchJobs } from "@/server/services/search-queue";
import { createTestDb, seedCompany, type TestDb } from "./helpers/test-db";

let handle: Awaited<ReturnType<typeof createTestDb>>;
let db: TestDb;
let companyId: string;
let answers: Response[];
let searched: string[];

beforeAll(async () => {
  handle = await createTestDb();
  db = handle.db;
  shared.db = db;
  collectorConfig.delayBetweenQueriesMs = 0;
  collectorConfig.classifyPollMs = 5;
  authorConfig.delayBetweenLookupsMs = 0;
  authorConfig.pollMs = 5;
}, 120_000);

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await handle.reset();
  await db.appSettings.deleteMany();
  companyId = (await seedCompany(db)).id;
  answers = [];
  searched = [];
  useRedditProvider("scrapebadger");
  vi.stubEnv("SCRAPEBADGER_API_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const address = new URL(url);
    if (address.pathname.includes("/users/")) {
      return new Response(JSON.stringify({ user: { name: address.pathname.split("/").pop(), total_karma: 5 } }), { status: 200 });
    }
    const query = address.searchParams.get("q") ?? "";
    searched.push(query);
    const answer = answers.shift();
    if (answer) return answer;
    return new Response(JSON.stringify({ posts: [fakePost(query)] }), { status: 200 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function fakePost(query: string) {
  const id = query.replace(/\W/g, "");
  return {
    id,
    title: `Tried ${id}`,
    selftext: "It was fine",
    subreddit: "webdev",
    author: `user_${id}`,
    url: `https://reddit.com/${id}`,
    permalink: `/r/webdev/comments/${id}`,
    created_utc: 1_700_000_000,
    is_self: true,
  };
}

function limited(retryAfterSeconds: string) {
  return new Response("", { status: 429, headers: { "Retry-After": retryAfterSeconds } });
}

async function workerFinished() {
  await vi.waitFor(() => expect(isCollectionActive()).toBe(false), { timeout: 15_000, interval: 25 });
}

async function run(id: string) {
  return db.collectionRun.findUniqueOrThrow({
    where: { id },
    include: { searches: true, logs: { orderBy: { timestamp: "asc" } } },
  });
}

describe("a rate limit during a real run", () => {
  it("shows the wait, then finishes every search", async () => {
    answers = [limited("1")];

    const started = await enqueueCollection(db, companyId);
    await vi.waitFor(async () => {
      expect((await run(started.runId)).waitingUntil).not.toBeNull();
    }, { timeout: 5_000, interval: 10 });

    const during = await run(started.runId);
    expect(during.status).toBe("running");
    expect(during.waitReason).toContain("429");
    expect(during.searches.find((search) => search.query === '"Alpha"')?.status).toBe("waiting");
    expect(during.searches.filter((search) => search.status === "running")).toHaveLength(0);

    await workerFinished();

    const finished = await run(started.runId);
    expect(finished).toMatchObject({ status: "completed", errorCount: 0, totalNew: 3, waitingUntil: null, waitReason: null });
    expect(finished.searches.map((search) => search.status)).toEqual(["done", "done", "done"]);
    expect(finished.searches.every((search) => search.error === null)).toBe(true);
    expect(searched).toEqual(['"Alpha"', '"Alpha"', '"Beta"', '"Gamma"']);
    expect(await db.redditPost.count({ where: { companyId } })).toBe(3);
    expect(finished.logs.map((log) => log.type)).toEqual(expect.arrayContaining(["waiting", "resumed", "completed"]));
    expect(finished.logs.some((log) => log.type === "error")).toBe(false);
  }, 20_000);

  it("keeps waiting through repeated limits", async () => {
    answers = [limited("0.05"), limited("0.05"), limited("0.05"), limited("0.05"), limited("0.05"), limited("0.05"), limited("0.05")];

    const started = await enqueueCollection(db, companyId);
    await workerFinished();

    const finished = await run(started.runId);
    expect(finished.status).toBe("completed");
    expect(finished.searches.every((search) => search.status === "done")).toBe(true);
    expect(finished.searches.find((search) => search.query === '"Alpha"')).toMatchObject({ waitCount: 7, attempts: 1 });
  }, 20_000);

  it("continues after running out of credits once they are added", async () => {
    answers = [new Response("", { status: 402 })];

    const started = await enqueueCollection(db, companyId);
    await vi.waitFor(async () => {
      expect((await run(started.runId)).waitReason).toContain("out of credits");
    }, { timeout: 5_000, interval: 10 });

    // The next balance check is ten minutes away, so bring it forward.
    await db.collectionRun.update({ where: { id: started.runId }, data: { waitingUntil: new Date(Date.now() - 1) } });
    await workerFinished();

    expect(await run(started.runId)).toMatchObject({ status: "completed", errorCount: 0, totalNew: 3 });
  }, 20_000);
});

describe("after a restart", () => {
  async function runCutOffDuringWait(until: Date) {
    const cut = await db.collectionRun.create({
      data: {
        companyId,
        status: "running",
        heartbeatAt: new Date(Date.now() - 10 * 60_000),
        waitingUntil: until,
        waitReason: "ScrapeBadger rate limited the request (429).",
      },
    });
    await ensureSearchJobs(db, cut.id, companyId, ['"Alpha"', '"Beta"', '"Gamma"'], []);
    await db.collectionSearch.updateMany({ where: { runId: cut.id, query: '"Alpha"' }, data: { status: "waiting" } });
    return cut;
  }

  it("picks up a run cut off during a wait, and does not search early", async () => {
    const until = new Date(Date.now() + 300);
    const cut = await runCutOffDuringWait(until);

    await checkSchedule();
    expect(searched).toEqual([]);
    await workerFinished();

    const finished = await run(cut.id);
    expect(finished).toMatchObject({ status: "completed", resumeCount: 0, totalNew: 3 });
    expect(searched).toHaveLength(3);
    expect(finished.searches.every((search) => search.startedAt!.getTime() >= until.getTime())).toBe(true);
  }, 20_000);

  it("continues with automatic collection off and no active session", async () => {
    await db.appSettings.create({ data: { id: "default", autoCollectEnabled: false, isOnboardingComplete: true } });
    const cut = await runCutOffDuringWait(new Date(Date.now() - 1));

    await checkSchedule();
    await workerFinished();

    expect((await run(cut.id)).status).toBe("completed");
  }, 20_000);

  it("still starts nothing new with automatic collection off", async () => {
    await db.appSettings.create({
      data: { id: "default", autoCollectEnabled: false, isOnboardingComplete: true, activeCompanyId: companyId },
    });

    await checkSchedule();

    expect(await db.collectionRun.count()).toBe(0);
  });
});

describe("what the schedule starts", () => {
  beforeEach(async () => {
    await db.appSettings.create({ data: { id: "default", isOnboardingComplete: true, activeCompanyId: companyId } });
  });

  async function addSession(autoCollect: boolean | null, name = "Other") {
    return seedCompany(db).then((company) =>
      db.company.update({ where: { id: company.id }, data: { name, autoCollect } }),
    );
  }

  it("starts a session on the schedule even when another is open", async () => {
    const other = await addSession(true);
    await db.collectionRun.create({
      data: { companyId, status: "completed", completedAt: new Date() },
    });

    await checkSchedule();
    await workerFinished();

    expect(await db.collectionRun.count({ where: { companyId: other.id, status: "completed" } })).toBe(1);
  }, 20_000);

  it("skips an older session that is not open, and one switched off", async () => {
    await addSession(null);
    await addSession(false);
    await db.collectionRun.create({
      data: { companyId, status: "completed", completedAt: new Date() },
    });

    await checkSchedule();

    expect(await db.collectionRun.count()).toBe(1);
  });

  it("still collects an older session while it is open", async () => {
    await checkSchedule();
    await workerFinished();

    expect(await db.collectionRun.count({ where: { companyId, status: "completed" } })).toBe(1);
  }, 20_000);

  it("waits out the interval, and starts the session that has waited longest", async () => {
    const other = await addSession(true);
    const recent = new Date();
    await db.collectionRun.create({ data: { companyId, status: "completed", completedAt: recent } });
    await db.collectionRun.create({ data: { companyId: other.id, status: "completed", completedAt: recent } });

    await checkSchedule();
    expect(await db.collectionRun.count()).toBe(2);

    const hourAgo = new Date(Date.now() - 3_600_000);
    const twoHoursAgo = new Date(Date.now() - 7_200_000);
    await db.collectionRun.updateMany({ where: { companyId }, data: { completedAt: hourAgo, startedAt: hourAgo } });
    await db.collectionRun.updateMany({ where: { companyId: other.id }, data: { completedAt: twoHoursAgo, startedAt: twoHoursAgo } });

    await checkSchedule();
    await workerFinished();

    const newest = await db.collectionRun.findFirstOrThrow({ orderBy: { startedAt: "desc" } });
    expect(newest.companyId).toBe(other.id);
  }, 20_000);

  it("leaves out a session with nothing to search", async () => {
    await db.searchQuery.deleteMany();
    await checkSchedule();
    expect(await db.collectionRun.count()).toBe(0);
  });
});

describe("while waiting", () => {
  it("does not start a second run, and a requested one waits its turn", async () => {
    answers = [limited("1")];
    const first = await enqueueCollection(db, companyId);
    await vi.waitFor(async () => {
      expect((await run(first.runId)).waitingUntil).not.toBeNull();
    }, { timeout: 5_000, interval: 10 });

    const second = await enqueueCollection(db, companyId);
    expect(second).toMatchObject({ queued: true });
    expect(await db.collectionRun.count({ where: { status: "running" } })).toBe(1);

    await vi.waitFor(async () => {
      expect((await run(second.runId)).status).toBe("completed");
    }, { timeout: 15_000, interval: 25 });
    expect((await run(first.runId)).status).toBe("completed");
    await workerFinished();
  }, 20_000);

  it("lets the session be deleted, and the worker stops cleanly", async () => {
    answers = [limited("1")];
    const started = await enqueueCollection(db, companyId);
    await vi.waitFor(async () => {
      expect((await run(started.runId)).waitingUntil).not.toBeNull();
    }, { timeout: 5_000, interval: 10 });

    await db.company.delete({ where: { id: companyId } });
    await workerFinished();

    expect(await db.collectionRun.count({ where: { id: started.runId } })).toBe(0);
  }, 20_000);
});
