/**
 * Durable search queue.
 *
 * Each search query is one job on a run. The job is acknowledged only after
 * its posts are saved, so a restart continues the unfinished jobs and does
 * not fetch a finished query again. One queued run per company is kept, the
 * same way a broker keeps a single waiting message.
 *
 * Everything here is plain database work, so it can be tested on a temp
 * SQLite file without the Reddit or classifier services.
 *
 * @module services/search-queue
 */

import type { db as dbType } from "@/server/db";
import { sleep, type ProviderWaitError } from "./reddit/http";

type PrismaClient = typeof dbType;

/** A search that was running when the worker stopped is retried once. */
export const MAX_SEARCH_ATTEMPTS = 2;
/** A paused run is resumed at most this many times in a row before it is marked failed. */
export const MAX_RESUMES = 3;
/** A running run with no heartbeat for this long has no worker. */
export const STALE_AFTER_MS = 90_000;
/**
 * A search the source keeps failing on is given up after this many tries, about
 * 8 minutes of waiting. The next run searches the same week of posts again.
 * Limits and empty credit balances have no cap, because they say nothing about
 * the search and it will work once they clear.
 */
export const MAX_OUTAGE_TRIES = 6;

const FIRST_WAIT_MS = 15_000;
const LONGEST_BACKOFF_MS = 15 * 60_000;
/** Empty balances are checked this often. A refused request costs no credits. */
const CREDIT_CHECK_MS = 10 * 60_000;
/** Whatever a source asks for, it is asked again after this long. */
const LONGEST_WAIT_MS = 60 * 60_000;
/** How often a wait checks that the run still exists. */
const WAIT_POLL_MS = 5_000;

/** Searches that still have to run. */
const WAITING_STATUSES = ["pending", "waiting"];
/** Searches that have not finished, including the one in progress. */
export const UNFINISHED_STATUSES = [...WAITING_STATUSES, "running"];

export async function ensureSearchJobs(
  db: PrismaClient,
  runId: string,
  companyId: string,
  selected: string[],
  omitted: string[],
): Promise<void> {
  for (const query of selected) {
    await db.collectionSearch.upsert({
      where: { runId_query: { runId, query } },
      create: { runId, companyId, query, status: "pending" },
      update: {},
    });
  }

  for (const query of omitted) {
    await db.collectionSearch.upsert({
      where: { runId_query: { runId, query } },
      create: { runId, companyId, query, status: "skipped", finishedAt: new Date() },
      update: {},
    });
  }
}

export async function claimNextSearch(db: PrismaClient, runId: string) {
  for (;;) {
    const next =
      (await db.collectionSearch.findFirst({ where: { runId, status: "waiting" } })) ??
      (await db.collectionSearch.findFirst({
        where: { runId, status: "pending" },
        orderBy: { createdAt: "asc" },
      }));
    if (!next) return null;

    const claimed = await db.collectionSearch.updateMany({
      where: { id: next.id, status: { in: WAITING_STATUSES } },
      data: { status: "running", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (claimed.count === 1) return next;
  }
}

/** How long to wait: what the source asked for, otherwise longer each time. */
export function waitLength(wait: Pick<ProviderWaitError, "kind" | "retryAfterMs">, waitCount: number): number {
  if (wait.retryAfterMs !== null) return Math.min(wait.retryAfterMs, LONGEST_WAIT_MS);
  if (wait.kind === "no_credits") return CREDIT_CHECK_MS;
  return Math.min(FIRST_WAIT_MS * 2 ** waitCount, LONGEST_BACKOFF_MS);
}

/**
 * Stops the queue until the source can take requests again. The search keeps
 * its place at the front, and being turned away does not use up its attempts.
 * The end of the wait is saved, so a restart keeps waiting instead of asking early.
 *
 * @returns When the queue resumes, or `null` when this search has failed too
 *   many times and should be marked failed so the queue can move on.
 */
export async function holdQueue(
  db: PrismaClient,
  runId: string,
  job: { id: string; waitCount: number; outageCount: number },
  wait: ProviderWaitError,
  now: number = Date.now(),
): Promise<Date | null> {
  const isOutage = wait.kind === "outage";
  if (isOutage && job.outageCount + 1 >= MAX_OUTAGE_TRIES) return null;

  const until = new Date(now + waitLength(wait, job.waitCount));
  await db.$transaction([
    db.collectionSearch.update({
      where: { id: job.id },
      data: {
        status: "waiting",
        error: wait.message.slice(0, 500),
        attempts: { decrement: 1 },
        waitCount: { increment: 1 },
        ...(isOutage ? { outageCount: { increment: 1 } } : {}),
      },
    }),
    db.collectionRun.update({
      where: { id: runId },
      data: { waitingUntil: until, waitReason: wait.message.slice(0, 500) },
    }),
  ]);
  return until;
}

/**
 * Sleeps until the run's wait is over, then clears it.
 *
 * @returns `false` when the run no longer exists, because its session was deleted.
 */
export async function sitOutHold(db: PrismaClient, runId: string): Promise<boolean> {
  for (;;) {
    const run = await db.collectionRun.findUnique({
      where: { id: runId },
      select: { waitingUntil: true },
    });
    if (!run) return false;
    if (!run.waitingUntil) return true;

    const left = run.waitingUntil.getTime() - Date.now();
    if (left <= 0) {
      await db.collectionRun.update({
        where: { id: runId },
        data: { waitingUntil: null, waitReason: null },
      });
      return true;
    }
    await sleep(Math.min(left, WAIT_POLL_MS));
  }
}

export async function completeSearch(
  db: PrismaClient,
  searchId: string,
  counts: { fetched: number; fresh: number; duplicates: number },
): Promise<void> {
  await db.collectionSearch.update({
    where: { id: searchId },
    data: {
      status: "done",
      fetchedCount: counts.fetched,
      newCount: counts.fresh,
      duplicateCount: counts.duplicates,
      finishedAt: new Date(),
      error: null,
    },
  });
}

export async function failSearch(db: PrismaClient, searchId: string, error: string): Promise<void> {
  await db.collectionSearch.update({
    where: { id: searchId },
    data: { status: "failed", error: error.slice(0, 500), finishedAt: new Date() },
  });
}

/**
 * Adds one classified post to the search that found it. The current run's
 * row is used first. A post found by an earlier run is credited to the most
 * recent finished row for the same query, so the tag still gets its result.
 */
export async function recordSearchOutcome(
  db: PrismaClient,
  runId: string,
  query: string,
  relevant: boolean,
  companyId?: string,
): Promise<void> {
  const data = relevant
    ? { relevantCount: { increment: 1 } }
    : { filteredCount: { increment: 1 } };

  const own = await db.collectionSearch.updateMany({ where: { runId, query }, data });
  if (own.count > 0) return;

  const latest = await db.collectionSearch.findFirst({
    where: { query, status: "done", ...(companyId ? { companyId } : {}) },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (latest) {
    await db.collectionSearch.update({ where: { id: latest.id }, data });
  }
}

async function logToRun(db: PrismaClient, runId: string, type: string, message: string) {
  await db.collectionLog.create({ data: { runId, type, message } });
}

/**
 * Brings a run that stopped back to a clean state.
 *
 * - `completed` and `queued` runs are left alone.
 * - A `failed` run keeps its status. Searches that never finished are marked
 *   failed so nothing shows as running forever.
 * - A `running` run puts unfinished searches back on the queue (once), then
 *   becomes `queued` when searches are waiting. It becomes `failed` when
 *   nothing is waiting, because it ended before it could write its result,
 *   or when it has already been resumed too many times. A restart during a
 *   wait is not held against the run, and its wait carries over.
 */
export async function settleInterruptedRun(
  db: PrismaClient,
  runId: string,
): Promise<"queued" | "completed" | "failed" | "unchanged"> {
  const run = await db.collectionRun.findUnique({ where: { id: runId } });
  if (!run || run.status === "completed" || run.status === "queued") return "unchanged";

  if (run.status === "failed") {
    await db.collectionSearch.updateMany({
      where: { runId, status: { in: UNFINISHED_STATUSES } },
      data: {
        status: "failed",
        error: "The run failed before this search finished",
        finishedAt: new Date(),
      },
    });
    return "failed";
  }

  await db.collectionSearch.updateMany({
    where: { runId, status: "running", attempts: { lt: MAX_SEARCH_ATTEMPTS } },
    data: { status: "pending" },
  });
  await db.collectionSearch.updateMany({
    where: { runId, status: "running", attempts: { gte: MAX_SEARCH_ATTEMPTS } },
    data: {
      status: "failed",
      error: "Stopped before the search finished",
      finishedAt: new Date(),
    },
  });

  const waiting = await db.collectionSearch.count({
    where: { runId, status: { in: WAITING_STATUSES } },
  });
  const onHold = run.waitingUntil !== null;

  if (waiting > 0 && (onHold || run.resumeCount < MAX_RESUMES)) {
    await db.collectionRun.update({
      where: { id: runId },
      data: {
        status: "queued",
        completedAt: null,
        ...(onHold ? {} : { resumeCount: { increment: 1 } }),
      },
    });
    await logToRun(
      db,
      runId,
      "info",
      "Run paused. Finished searches stay done, and the rest stay on the queue.",
    );
    return "queued";
  }

  if (waiting > 0) {
    await db.collectionSearch.updateMany({
      where: { runId, status: { in: WAITING_STATUSES } },
      data: {
        status: "failed",
        error: "Gave up after the run stopped several times",
        finishedAt: new Date(),
      },
    });
  }

  await db.collectionRun.update({
    where: { id: runId },
    data: {
      status: "failed",
      completedAt: new Date(),
      errorCount: { increment: 1 },
      waitingUntil: null,
      waitReason: null,
    },
  });
  await logToRun(
    db,
    runId,
    "error",
    waiting > 0
      ? "Run stopped too many times and was ended. Saved posts were kept."
      : "Run stopped before it finished. Saved posts were kept and unclassified posts are picked up next run.",
  );
  return "failed";
}

/** Updates the heartbeat that tells other callers a worker still owns this run. */
export async function touchRun(db: PrismaClient, runId: string): Promise<void> {
  await db.collectionRun.updateMany({
    where: { id: runId, status: "running" },
    data: { heartbeatAt: new Date() },
  });
}

/**
 * Settles every `running` run that no worker owns. `isActive` says whether
 * this process is working on a run. A run another process is working on is
 * left alone while its heartbeat is fresh.
 */
export async function recoverOrphanedRuns(
  db: PrismaClient,
  isActive: (runId: string) => boolean,
  now: number = Date.now(),
): Promise<void> {
  const running = await db.collectionRun.findMany({ where: { status: "running" } });

  for (const run of running) {
    if (isActive(run.id)) continue;
    const lastBeat = (run.heartbeatAt ?? run.startedAt).getTime();
    if (now - lastBeat < STALE_AFTER_MS) continue;
    await settleInterruptedRun(db, run.id);
  }
}

/** A running run with a fresh heartbeat, even if another process owns it. */
export async function findLiveRun(db: PrismaClient, companyId: string) {
  return db.collectionRun.findFirst({
    where: { companyId, status: "running" },
    orderBy: { startedAt: "desc" },
  });
}

let queueChain: Promise<unknown> = Promise.resolve();

/** One waiting run per company. A second request does not create another. */
export function ensureQueuedRun(db: PrismaClient, companyId: string) {
  const next = queueChain.then(async () => {
    const existing = await db.collectionRun.findFirst({
      where: { companyId, status: "queued" },
      orderBy: { startedAt: "asc" },
    });
    if (existing) return existing;

    return db.collectionRun.create({ data: { companyId, status: "queued" } });
  });
  queueChain = next.catch(() => undefined);
  return next;
}

/**
 * The run the dashboard should show: the running one first, otherwise the
 * newest run that has something to report. An empty queued placeholder is
 * not shown, but a paused run with searches is.
 */
export async function findDisplayRun(db: PrismaClient, companyId: string) {
  const include = {
    logs: { orderBy: { timestamp: "desc" as const }, take: 100 },
    searches: { orderBy: { createdAt: "asc" as const } },
  };

  const running = await db.collectionRun.findFirst({
    where: { companyId, status: "running" },
    orderBy: { startedAt: "desc" },
    include,
  });
  if (running) return running;

  return db.collectionRun.findFirst({
    where: { companyId, NOT: { status: "queued", searches: { none: {} } } },
    orderBy: { startedAt: "desc" },
    include,
  });
}
