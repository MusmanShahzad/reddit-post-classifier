/**
 * Collection Pipeline Orchestrator
 *
 * The heart of Radarr's data pipeline. {@link runCollection} is an async
 * generator that yields typed {@link CollectionEvent} objects as it progresses
 * from separate tracks running at the same time:
 *
 * - **Searches** — one at a time: fetch from the provider selected by
 *   `REDDIT_PROVIDER`, deduplicate, and save new posts as `status: "pending"`.
 *   A rate limit here pauses only the searches.
 * - **Classification** — several posts at once, as soon as they are saved: Jev
 *   labels, then a GPT-4o-mini one-liner for posts that pass the filter. A rate
 *   limit here delays only the post it happened on.
 * - **Author profiles** — after the searches, for authors of relevant posts.
 *
 * `startCollection` in `collection-runs.ts` drains this generator in the
 * background and stores every event as a `CollectionLog` row.
 *
 * @module services/collector
 */

import { pausedSearches } from "@/lib/search-stats";
import { lookUpAuthors } from "./authors";
import { classifyLane } from "./classify-lane";
import {
  logToRun,
  type ClassifyCompany,
  type CollectionEvent,
  type CollectionStats,
  type PrismaClient,
} from "./collection-shared";
import { queriesForCollection } from "./reddit";
import { ensureSearchJobs, UNFINISHED_STATUSES } from "./search-queue";
import { planSearches, searchLane } from "./search-lane";

export { MAX_CLASSIFY_ATTEMPTS, MAX_CONSECUTIVE_CLASSIFY_FAILURES } from "./classify-lane";
export { collectorConfig, type CollectionEvent, type CollectionStats } from "./collection-shared";

const searchWord = (count: number) => `${count} ${count === 1 ? "search" : "searches"}`;

/**
 * Runs the full collection pipeline for a company, yielding progress events.
 *
 * Pass `runId` to fill an existing `CollectionRun` row instead of creating one.
 *
 * @param db        - Prisma client instance.
 * @param companyId - ID of the company to collect for.
 * @yields {CollectionEvent} Typed progress events for each pipeline stage.
 *
 * @example
 * ```ts
 * for await (const event of runCollection(db, companyId)) {
 *   console.log(event.type, event.message);
 * }
 * ```
 */
export async function* runCollection(
  db: PrismaClient,
  companyId: string,
  runId?: string,
): AsyncGenerator<CollectionEvent> {
  const company = await db.company.findUnique({
    where: { id: companyId },
    include: {
      keywords: true,
      subreddits: { where: { isActive: true } },
      searchQueries: { where: { isActive: true } },
    },
  });

  if (!company) {
    yield { type: "error", error: "Company not found", message: "Company not found" };
    return;
  }

  const run = runId
    ? { id: runId }
    : await db.collectionRun.create({ data: { companyId, status: "running" } });

  const savedRun = await db.collectionRun.findUnique({ where: { id: run.id } });
  const stats: CollectionStats = {
    totalFetched: savedRun?.totalFetched ?? 0,
    totalNew: savedRun?.totalNew ?? 0,
    totalClassified: savedRun?.totalClassified ?? 0,
    totalRelevant: savedRun?.totalRelevant ?? 0,
    totalFiltered: savedRun?.totalFiltered ?? 0,
    errorCount: savedRun?.errorCount ?? 0,
  };

  try {
    // Stage 1: Build search queries
    const planned = queriesForCollection(company.searchQueries);
    if (planned.selected.length === 0) {
      await db.collectionRun.update({
        where: { id: run.id },
        data: { status: "failed", completedAt: new Date(), errorCount: 1 },
      });
      yield { type: "error", error: "No search queries configured", message: "No search queries" };
      return;
    }

    const subreddits = company.subreddits.map((s) => s.name);
    const history = await db.collectionSearch.findMany({
      where: { companyId: company.id, runId: { not: run.id } },
      orderBy: { createdAt: "desc" },
      select: { query: true, status: true, relevantCount: true },
      take: 200,
    });
    const { queries, omitted } = planSearches(planned, company, pausedSearches(history));
    const skipped = omitted.length;

    await ensureSearchJobs(db, run.id, company.id, queries, omitted);
    const alreadyDone = await db.collectionSearch.count({
      where: { runId: run.id, status: "done" },
    });
    const waiting = await db.collectionSearch.count({
      where: { runId: run.id, status: { in: UNFINISHED_STATUSES } },
    });

    const scope = skipped > 0
      ? `${searchWord(queries.length)} (${skipped} left off the queue to save credits)`
      : searchWord(queries.length);

    yield {
      type: "started",
      message: alreadyDone > 0
        ? `Continuing the queue for ${company.name}. ${alreadyDone} searches already done, ${waiting} still waiting.`
        : `Collection started for ${company.name}. ${scope}.`,
    };

    const events = eventChannel<CollectionEvent>();
    let searchesFinished = false;
    let classifyFinished = false;

    const searching = (async () => {
      for await (const event of searchLane(db, run.id, company, subreddits, stats)) events.push(event);
    })().finally(() => {
      searchesFinished = true;
    });
    const classifying = classifyLane(db, company, run.id, stats, events.push, () => searchesFinished).finally(() => {
      classifyFinished = true;
    });
    // Searches come first, so a lookup never uses up the limit a search needs.
    const lookingUp = searching
      .catch(() => undefined)
      .then(() => lookUpAuthors(db, company.id, () => !classifyFinished))
      .catch((error: unknown) => {
        console.warn(`[authors] ${error instanceof Error ? error.message : "Unknown"}`);
      });

    const settled = Promise.allSettled([searching, classifying, lookingUp]).finally(events.close);
    yield* events.stream();
    for (const lane of await settled) {
      if (lane.status === "rejected") throw lane.reason;
    }

    // The session was deleted during the run, so there is nothing to report on.
    if (!(await db.collectionRun.findUnique({ where: { id: run.id }, select: { id: true } }))) return;

    await logToRun(db, run.id, "classify", `Classified ${stats.totalClassified}: ${stats.totalRelevant} relevant, ${stats.totalFiltered} filtered`);
    await logToRun(db, run.id, "summarize", `Wrote one-line reasons for ${stats.totalRelevant} posts that passed the filter`);

    // A run where every search failed did not collect anything. Say so.
    const [searchesDone, searchesFailed] = await Promise.all([
      db.collectionSearch.count({ where: { runId: run.id, status: "done" } }),
      db.collectionSearch.count({ where: { runId: run.id, status: "failed" } }),
    ]);
    const everySearchFailed = searchesDone === 0 && searchesFailed > 0;

    await db.collectionRun.update({
      where: { id: run.id },
      data: {
        status: everySearchFailed ? "failed" : "completed",
        completedAt: new Date(),
        ...stats,
      },
    });

    if (everySearchFailed) {
      yield {
        type: "error",
        error: `All ${searchesFailed} searches failed`,
        message: "Collection failed. No posts were fetched",
      };
      return;
    }

    yield {
      type: "completed",
      stats,
      message: `Collection complete! ${stats.totalNew} new posts, ${stats.totalRelevant} kept.`,
    };
  } catch (error) {
    // Searches left on the queue are not lost to an unexpected error. The run
    // stays "running", so the worker's settle step puts it back on the queue.
    const unfinished = await db.collectionSearch.count({
      where: { runId: run.id, status: { in: UNFINISHED_STATUSES } },
    });
    await db.collectionRun.update({
      where: { id: run.id },
      data: unfinished > 0 ? { ...stats } : { status: "failed", completedAt: new Date(), ...stats },
    });

    yield {
      type: "error",
      error: error instanceof Error ? error.message : "Unknown error",
      message: unfinished > 0 ? "Collection stopped. Unfinished searches stay on the queue" : "Collection failed",
    };
  }
}

/** Passes events from tracks running at the same time to one reader, in order. */
function eventChannel<T>() {
  const waiting: T[] = [];
  let closed = false;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };

  return {
    push: (event: T) => {
      waiting.push(event);
      notify();
    },
    close: () => {
      closed = true;
      notify();
    },
    async *stream(): AsyncGenerator<T> {
      for (;;) {
        while (waiting.length > 0) yield waiting.shift()!;
        if (closed) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}
