import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  claimNextSearch,
  completeSearch,
  ensureQueuedRun,
  ensureSearchJobs,
  failSearch,
  findDisplayRun,
  holdQueue,
  MAX_OUTAGE_TRIES,
  MAX_RESUMES,
  recordSearchOutcome,
  recoverOrphanedRuns,
  settleInterruptedRun,
  sitOutHold,
  STALE_AFTER_MS,
  waitLength,
} from "@/server/services/search-queue";
import { ProviderWaitError } from "@/server/services/reddit/http";
import { createTestDb, seedCompany, type TestDb } from "./helpers/test-db";

let handle: Awaited<ReturnType<typeof createTestDb>>;
let db: TestDb;
let companyId: string;

beforeAll(async () => {
  handle = await createTestDb();
  db = handle.db;
}, 120_000);

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  await handle.reset();
  companyId = (await seedCompany(db)).id;
});

async function makeRun(data: Record<string, unknown> = {}) {
  return db.collectionRun.create({ data: { companyId, status: "running", ...data } });
}

async function jobStatuses(runId: string) {
  const rows = await db.collectionSearch.findMany({ where: { runId }, orderBy: { query: "asc" } });
  return Object.fromEntries(rows.map((row) => [row.query, row.status]));
}

describe("ensureSearchJobs", () => {
  it("is idempotent and marks omitted searches skipped", async () => {
    const run = await makeRun();
    await ensureSearchJobs(db, run.id, companyId, ["a", "b"], ["c"]);
    await ensureSearchJobs(db, run.id, companyId, ["a", "b"], ["c"]);

    expect(await jobStatuses(run.id)).toEqual({ a: "pending", b: "pending", c: "skipped" });
  });

  it("does not reset a finished search when called again", async () => {
    const run = await makeRun();
    await ensureSearchJobs(db, run.id, companyId, ["a"], []);
    const job = await claimNextSearch(db, run.id);
    await completeSearch(db, job!.id, { fetched: 5, fresh: 4, duplicates: 1 });

    await ensureSearchJobs(db, run.id, companyId, ["a"], []);

    const row = await db.collectionSearch.findUniqueOrThrow({ where: { id: job!.id } });
    expect(row).toMatchObject({ status: "done", fetchedCount: 5, newCount: 4, duplicateCount: 1 });
  });
});

describe("claimNextSearch", () => {
  it("hands each job to exactly one caller", async () => {
    const run = await makeRun();
    await ensureSearchJobs(db, run.id, companyId, ["a", "b", "c"], []);

    const claims = await Promise.all([1, 2, 3, 4, 5].map(() => claimNextSearch(db, run.id)));
    const claimed = claims.filter(Boolean).map((job) => job!.id);

    expect(claimed).toHaveLength(3);
    expect(new Set(claimed).size).toBe(3);
  });

  it("counts an attempt each time", async () => {
    const run = await makeRun();
    await ensureSearchJobs(db, run.id, companyId, ["a"], []);
    const job = await claimNextSearch(db, run.id);
    const row = await db.collectionSearch.findUniqueOrThrow({ where: { id: job!.id } });
    expect(row).toMatchObject({ status: "running", attempts: 1 });
  });
});

describe("recordSearchOutcome", () => {
  it("credits the run's own search first", async () => {
    const run = await makeRun();
    await ensureSearchJobs(db, run.id, companyId, ["a"], []);
    await recordSearchOutcome(db, run.id, "a", true, companyId);
    await recordSearchOutcome(db, run.id, "a", false, companyId);

    const row = await db.collectionSearch.findFirstOrThrow({ where: { runId: run.id } });
    expect(row).toMatchObject({ relevantCount: 1, filteredCount: 1 });
  });

  it("credits the latest finished search when the post came from an earlier run", async () => {
    const earlier = await makeRun({ status: "completed" });
    await ensureSearchJobs(db, earlier.id, companyId, ["a"], []);
    const job = await claimNextSearch(db, earlier.id);
    await completeSearch(db, job!.id, { fetched: 1, fresh: 1, duplicates: 0 });

    const later = await makeRun();
    await recordSearchOutcome(db, later.id, "a", true, companyId);

    const row = await db.collectionSearch.findUniqueOrThrow({ where: { id: job!.id } });
    expect(row.relevantCount).toBe(1);
  });

  it("does nothing when no search ever matched", async () => {
    const run = await makeRun();
    await expect(recordSearchOutcome(db, run.id, "ghost", true, companyId)).resolves.toBeUndefined();
  });
});

describe("settleInterruptedRun", () => {
  it("puts an interrupted search back on the queue and pauses the run", async () => {
    const run = await makeRun();
    await ensureSearchJobs(db, run.id, companyId, ["a", "b"], []);
    await claimNextSearch(db, run.id);

    expect(await settleInterruptedRun(db, run.id)).toBe("queued");

    expect(await jobStatuses(run.id)).toEqual({ a: "pending", b: "pending" });
    const saved = await db.collectionRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved).toMatchObject({ status: "queued", resumeCount: 1 });
    expect(await db.collectionLog.count({ where: { runId: run.id } })).toBe(1);
  });

  it("keeps finished searches done", async () => {
    const run = await makeRun();
    await ensureSearchJobs(db, run.id, companyId, ["a", "b"], []);
    const first = await claimNextSearch(db, run.id);
    await completeSearch(db, first!.id, { fetched: 3, fresh: 3, duplicates: 0 });
    await claimNextSearch(db, run.id);

    await settleInterruptedRun(db, run.id);

    expect(await jobStatuses(run.id)).toEqual({ a: "done", b: "pending" });
  });

  it("retries a search once, then fails it", async () => {
    const run = await makeRun();
    await ensureSearchJobs(db, run.id, companyId, ["a"], []);
    await claimNextSearch(db, run.id);
    await settleInterruptedRun(db, run.id);
    await db.collectionRun.update({ where: { id: run.id }, data: { status: "running" } });
    await claimNextSearch(db, run.id);

    expect(await settleInterruptedRun(db, run.id)).toBe("failed");
    expect(await jobStatuses(run.id)).toEqual({ a: "failed" });
  });

  it("fails a run that stopped with nothing left to do", async () => {
    const run = await makeRun();
    expect(await settleInterruptedRun(db, run.id)).toBe("failed");
    const saved = await db.collectionRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved.status).toBe("failed");
    expect(saved.completedAt).not.toBeNull();
  });

  it("does not override a run that already failed, but closes loose searches", async () => {
    const run = await makeRun({ status: "failed" });
    await ensureSearchJobs(db, run.id, companyId, ["a", "b"], []);
    await claimNextSearch(db, run.id);

    expect(await settleInterruptedRun(db, run.id)).toBe("failed");

    expect(await jobStatuses(run.id)).toEqual({ a: "failed", b: "failed" });
    expect((await db.collectionRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("failed");
  });

  it("leaves completed and queued runs alone", async () => {
    const done = await makeRun({ status: "completed" });
    const waiting = await makeRun({ status: "queued" });
    expect(await settleInterruptedRun(db, done.id)).toBe("unchanged");
    expect(await settleInterruptedRun(db, waiting.id)).toBe("unchanged");
    expect(await settleInterruptedRun(db, "missing")).toBe("unchanged");
  });

  it("ends a run that keeps getting interrupted", async () => {
    const run = await makeRun({ resumeCount: MAX_RESUMES });
    await ensureSearchJobs(db, run.id, companyId, ["a", "b"], []);

    expect(await settleInterruptedRun(db, run.id)).toBe("failed");
    expect(await jobStatuses(run.id)).toEqual({ a: "failed", b: "failed" });
  });
});

describe("waiting on the source", () => {
  const limited = new ProviderWaitError("Rate limited (429).", "rate_limit", 30_000);

  async function claimOne(queries = ["a", "b"]) {
    const run = await makeRun();
    await ensureSearchJobs(db, run.id, companyId, queries, []);
    return { run, job: (await claimNextSearch(db, run.id))! };
  }

  it("uses the wait the source asked for, within a limit", () => {
    expect(waitLength({ kind: "rate_limit", retryAfterMs: 30_000 }, 4)).toBe(30_000);
    expect(waitLength({ kind: "rate_limit", retryAfterMs: 86_400_000 }, 0)).toBe(3_600_000);
  });

  it("waits longer each time when the source does not say", () => {
    const waits = [0, 1, 2, 20].map((count) => waitLength({ kind: "rate_limit", retryAfterMs: null }, count));
    expect(waits).toEqual([15_000, 30_000, 60_000, 900_000]);
  });

  it("saves the wait and keeps the search without using an attempt", async () => {
    const { run, job } = await claimOne();
    const now = Date.now();

    const until = await holdQueue(db, run.id, job, limited, now);

    expect(until?.getTime()).toBe(now + 30_000);
    expect(await db.collectionSearch.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({
      status: "waiting",
      attempts: 0,
      waitCount: 1,
      outageCount: 0,
      error: "Rate limited (429).",
    });
    expect(await db.collectionRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: "running",
      waitingUntil: until,
      waitReason: "Rate limited (429).",
    });
  });

  it("runs the search that waited before any other", async () => {
    const { run, job } = await claimOne();
    await holdQueue(db, run.id, job, limited);

    expect((await claimNextSearch(db, run.id))?.id).toBe(job.id);
    expect((await claimNextSearch(db, run.id))?.query).toBe("b");
  });

  it("never gives up on a rate limit or an empty balance", async () => {
    const { run, job } = await claimOne();
    const worn = { ...job, waitCount: 500, outageCount: 500 };

    expect(await holdQueue(db, run.id, worn, limited)).not.toBeNull();
    expect(await holdQueue(db, run.id, worn, new ProviderWaitError("Empty", "no_credits"))).not.toBeNull();
  });

  it("gives up on a search the source keeps failing on, so the queue moves on", async () => {
    const { run, job } = await claimOne();
    const outage = new ProviderWaitError("Unavailable (500).", "outage");

    expect(await holdQueue(db, run.id, { ...job, outageCount: MAX_OUTAGE_TRIES - 2 }, outage)).not.toBeNull();
    expect(await holdQueue(db, run.id, { ...job, outageCount: MAX_OUTAGE_TRIES - 1 }, outage)).toBeNull();
  });

  it("carries the wait through a restart without counting it as a crash", async () => {
    const { run, job } = await claimOne();
    const until = await holdQueue(db, run.id, job, limited);

    expect(await settleInterruptedRun(db, run.id)).toBe("queued");

    expect(await db.collectionRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: "queued",
      resumeCount: 0,
      waitingUntil: until,
    });
    expect(await jobStatuses(run.id)).toEqual({ a: "waiting", b: "pending" });
  });

  it("survives any number of restarts during a wait", async () => {
    const { run, job } = await claimOne();
    await holdQueue(db, run.id, job, limited);
    await db.collectionRun.update({ where: { id: run.id }, data: { resumeCount: MAX_RESUMES } });

    expect(await settleInterruptedRun(db, run.id)).toBe("queued");
    expect(await jobStatuses(run.id)).toEqual({ a: "waiting", b: "pending" });
  });

  it("closes a waiting search when the run has failed", async () => {
    const { run, job } = await claimOne(["a"]);
    await holdQueue(db, run.id, job, limited);
    await db.collectionRun.update({ where: { id: run.id }, data: { status: "failed" } });

    await settleInterruptedRun(db, run.id);

    expect(await jobStatuses(run.id)).toEqual({ a: "failed" });
  });

  it("clears the wait when it is over", async () => {
    const run = await makeRun({ waitingUntil: new Date(Date.now() + 20), waitReason: "Limited" });

    expect(await sitOutHold(db, run.id)).toBe(true);

    const saved = await db.collectionRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(saved.waitingUntil).toBeNull();
    expect(saved.waitReason).toBeNull();
    expect(Date.now()).toBeGreaterThanOrEqual(run.waitingUntil!.getTime());
  });

  it("stops waiting when the run is deleted", async () => {
    expect(await sitOutHold(db, "missing")).toBe(false);
  });
});

describe("recoverOrphanedRuns", () => {
  const now = Date.now();

  it("leaves a run alone while its heartbeat is fresh", async () => {
    const run = await makeRun({ heartbeatAt: new Date(now - 5_000) });
    await recoverOrphanedRuns(db, () => false, now);
    expect((await db.collectionRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("running");
  });

  it("settles a run whose heartbeat went stale", async () => {
    const run = await makeRun({ heartbeatAt: new Date(now - STALE_AFTER_MS - 1_000) });
    await ensureSearchJobs(db, run.id, companyId, ["a"], []);
    await recoverOrphanedRuns(db, () => false, now);
    expect((await db.collectionRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("queued");
  });

  it("uses the start time when there is no heartbeat", async () => {
    const run = await makeRun({ startedAt: new Date(now - STALE_AFTER_MS - 1_000) });
    await recoverOrphanedRuns(db, () => false, now);
    expect((await db.collectionRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("failed");
  });

  it("never touches a run this process is working on", async () => {
    const run = await makeRun({ heartbeatAt: new Date(now - STALE_AFTER_MS * 10) });
    await recoverOrphanedRuns(db, (id) => id === run.id, now);
    expect((await db.collectionRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("running");
  });
});

describe("ensureQueuedRun", () => {
  it("keeps exactly one waiting run even when asked at the same time", async () => {
    const runs = await Promise.all([1, 2, 3, 4].map(() => ensureQueuedRun(db, companyId)));
    expect(new Set(runs.map((run) => run.id)).size).toBe(1);
    expect(await db.collectionRun.count({ where: { status: "queued" } })).toBe(1);
  });
});

describe("findDisplayRun", () => {
  it("shows the running run even when a newer run is waiting", async () => {
    const running = await makeRun({ startedAt: new Date(Date.now() - 60_000) });
    await ensureSearchJobs(db, running.id, companyId, ["a"], []);
    await makeRun({ status: "queued" });

    expect((await findDisplayRun(db, companyId))?.id).toBe(running.id);
  });

  it("hides an empty waiting placeholder behind the last real run", async () => {
    const done = await makeRun({ status: "completed", startedAt: new Date(Date.now() - 60_000) });
    await makeRun({ status: "queued" });

    expect((await findDisplayRun(db, companyId))?.id).toBe(done.id);
  });

  it("shows a paused run that has searches", async () => {
    await makeRun({ status: "completed", startedAt: new Date(Date.now() - 60_000) });
    const paused = await makeRun({ status: "queued" });
    await ensureSearchJobs(db, paused.id, companyId, ["a"], []);

    const shown = await findDisplayRun(db, companyId);
    expect(shown?.id).toBe(paused.id);
    expect(shown?.searches).toHaveLength(1);
  });

  it("returns null with no runs", async () => {
    expect(await findDisplayRun(db, companyId)).toBeNull();
  });

  it("never shows another session's run", async () => {
    const other = await db.company.create({ data: { name: "Other" } });
    await db.collectionRun.create({ data: { companyId: other.id, status: "running" } });

    expect(await findDisplayRun(db, companyId)).toBeNull();
  });

  it("failSearch truncates a huge error", async () => {
    const run = await makeRun();
    await ensureSearchJobs(db, run.id, companyId, ["a"], []);
    const job = await claimNextSearch(db, run.id);
    await failSearch(db, job!.id, "x".repeat(5_000));
    const row = await db.collectionSearch.findUniqueOrThrow({ where: { id: job!.id } });
    expect(row.error).toHaveLength(500);
  });
});
