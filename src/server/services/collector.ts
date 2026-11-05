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

import type { db as dbType } from "@/server/db";
type PrismaClient = typeof dbType;
import {
  isSubredditSearch,
  queriesForCollection,
  searchReddit,
  subredditsForOneSearch,
  withoutBuyingWords,
  type RedditPostRaw,
} from "./reddit";
import { parseGoals } from "@/lib/goals";
import { pausedSearches } from "@/lib/search-stats";
import { ProviderWaitError, sleep } from "./reddit/http";
import { lookUpAuthors } from "./authors";
import { classifyPost, type ClassificationResult } from "./classifier";
import { rateLimitWait } from "@/lib/rate-limit";
import { writeReason } from "./reason";
import { aliasList, namesInQuery, trackedKeyword } from "@/lib/post-tags";
import { judgeDecision, mentionsName, sessionEvidence } from "@/lib/filter-checks";
import { linkPostKeywords } from "./post-tags";
import {
  claimNextSearch,
  completeSearch,
  ensureSearchJobs,
  failSearch,
  holdQueue,
  recordSearchOutcome,
  sitOutHold,
  UNFINISHED_STATUSES,
} from "./search-queue";

/** Tunable values. Tests set the delay to 0. */
export const collectorConfig = {
  /** Delay in ms between successive Reddit API calls to stay under rate limits. */
  delayBetweenQueriesMs: 1500,
  /** Posts classified at the same time. */
  classifyConcurrency: 5,
  /** How often classification looks for newly saved posts while it has room. */
  classifyPollMs: 1000,
};

/** A post that fails to classify this many times is marked "error" and left alone. */
export const MAX_CLASSIFY_ATTEMPTS = 3;
/** This many failures in a row stop classification for the run. */
export const MAX_CONSECUTIVE_CLASSIFY_FAILURES = 5;
/** A rate limited post is tried this many times in one run, then waits for the next run. */
const MAX_CLASSIFY_WAITS_PER_RUN = 6;
/** The first wait for a rate limited post when the service does not say how long. Doubles each time. */
const FIRST_CLASSIFY_WAIT_MS = 15_000;
/** A post asked to wait longer than this does not hold the run open. The next run picks it up. */
const LONGEST_CLASSIFY_WAIT_MS = 5 * 60_000;

const searchWord = (count: number) => `${count} ${count === 1 ? "search" : "searches"}`;

/** A wait in words. Log lines use lengths, because the server's clock may not match the reader's. */
function waitWords(until: Date): string {
  const seconds = Math.max(1, Math.round((until.getTime() - Date.now()) / 1000));
  if (seconds === 1) return "1 second";
  if (seconds < 90) return `${seconds} seconds`;
  return `${Math.round(seconds / 60)} minutes`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Discriminated-union type for every event the collection pipeline can yield.
 *
 * The `type` field identifies the stage; each variant carries relevant data.
 */
export type CollectionEvent =
  | { type: "started"; message: string }
  | { type: "fetching"; query: string; message: string }
  | { type: "fetched"; query: string; count: number; message: string }
  | { type: "waiting"; until: Date; message: string }
  | { type: "resumed"; message: string }
  | { type: "dedup"; totalNew: number; totalSkipped: number; message: string }
  | { type: "classifying"; postTitle: string; message: string }
  | { type: "post_waiting"; until: Date; message: string }
  | { type: "classified"; postTitle: string; category: string; isRelevant: boolean; message: string }
  | { type: "summarizing"; current: number; total: number; message: string }
  | { type: "completed"; stats: CollectionStats; message: string }
  | { type: "error"; error: string; message: string };

/** Aggregate statistics for a completed (or partially-completed) collection run. */
export interface CollectionStats {
  totalFetched: number;
  totalNew: number;
  totalClassified: number;
  totalRelevant: number;
  totalFiltered: number;
  errorCount: number;
}

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

/**
 * Runs the search queue. A wait here pauses only the searches, so posts already
 * saved keep being classified.
 */
async function* searchLane(
  db: PrismaClient,
  runId: string,
  company: { id: string; keywords: ClassifyCompany["keywords"] },
  subreddits: string[],
  stats: CollectionStats,
): AsyncGenerator<CollectionEvent> {
  const seenIds = new Set<string>();
  const emptySteps = new Map<string, number>();
  let fresh = 0;
  let duplicates = 0;

  for (;;) {
    // Also covers a wait saved before a restart.
    if (!(yield* waitOutHold(db, runId))) return;

    const job = await claimNextSearch(db, runId);
    if (!job) break;

    const found = yield* runSearchJob(db, runId, company, job, subreddits, stats, seenIds, emptySteps);
    fresh += found.saved;
    duplicates += found.duplicates;

    await sleep(collectorConfig.delayBetweenQueriesMs);
  }

  yield {
    type: "dedup",
    totalNew: fresh,
    totalSkipped: duplicates,
    message: `${fresh} new posts (${duplicates} duplicates skipped)`,
  };
  await logToRun(db, runId, "fetch", `Queue finished this pass: ${fresh} new posts, ${duplicates} duplicates`);
}

/** Returns `false` when the run was deleted during the wait. */
async function* waitOutHold(db: PrismaClient, runId: string): AsyncGenerator<CollectionEvent, boolean> {
  const run = await db.collectionRun.findUnique({
    where: { id: runId },
    select: { waitingUntil: true },
  });
  if (!run) return false;
  if (!run.waitingUntil) return true;

  if (!(await sitOutHold(db, runId))) return false;
  yield { type: "resumed", message: "The wait is over. Continuing the queue." };
  return true;
}

interface ClassifyCompany {
  id: string;
  name: string;
  product: string;
  buyer: string;
  keepWhen: string;
  notAbout: string;
  goals: string;
  keywords: { id: string; type: string; value: string; aliases: string }[];
}

/**
 * The searches this run pays for. The company's own name and hand-written
 * searches always run. A subreddit search needs subreddits, and a search that
 * has found nothing useful sits out. If that would leave nothing, all of them run.
 */
function planSearches(
  planned: { selected: string[]; omitted: string[] },
  company: {
    keywords: ClassifyCompany["keywords"];
    subreddits: unknown[];
    searchQueries: { query: string; isCustom: boolean }[];
  },
  paused: Set<string>,
): { queries: string[]; omitted: string[] } {
  const brandKeywords = company.keywords.filter((keyword) => keyword.type === "brand");
  const customQueries = new Set(
    company.searchQueries.filter((row) => row.isCustom).map((row) => row.query.trim()),
  );
  const leftOut = (query: string) => {
    if (customQueries.has(query) || namesInQuery(query, brandKeywords).length > 0) return false;
    if (company.subreddits.length === 0 && isSubredditSearch(query)) return true;
    return paused.has(query);
  };

  const running = planned.selected.filter((query) => !leftOut(query));
  const queries = running.length > 0 ? running : planned.selected;
  return {
    queries,
    omitted: [...planned.omitted, ...planned.selected.filter((query) => !queries.includes(query))],
  };
}

/** Saves a search's new posts. One bad post must not throw away the rest. */
async function saveNewPosts(
  db: PrismaClient,
  company: { id: string; keywords: ClassifyCompany["keywords"] },
  posts: RedditPostRaw[],
) {
  const result = { saved: 0, duplicates: 0, errors: 0, firstError: "" };
  for (const rawPost of posts) {
    try {
      const stored = await storePost(db, company.id, rawPost);
      if (stored === "duplicate") {
        result.duplicates++;
      } else {
        result.saved++;
        await linkPostKeywords(
          db,
          stored.id,
          rawPost.matchedQuery,
          company.keywords,
          `${rawPost.title} ${rawPost.selftext ?? ""}`,
        );
      }
    } catch (error) {
      result.errors++;
      result.firstError ||= error instanceof Error ? error.message : "Unknown";
    }
  }
  return result;
}

const WIDER_WINDOWS = ["month", "year"] as const;

/** Whether this search has ever returned anything for this session. */
async function hasFoundPosts(db: PrismaClient, companyId: string, query: string): Promise<boolean> {
  const found = await db.collectionSearch.count({ where: { companyId, query, fetchedCount: { gt: 0 } } });
  return found > 0;
}

/** Runs one search from the queue. Names and exact phrases cover all of Reddit; loose topic searches stay in the subreddits. */
async function* runSearchJob(
  db: PrismaClient,
  runId: string,
  company: { id: string; keywords: ClassifyCompany["keywords"] },
  job: { id: string; query: string; waitCount: number; outageCount: number },
  subreddits: string[],
  stats: CollectionStats,
  seenIds: Set<string>,
  emptySteps: Map<string, number>,
): AsyncGenerator<CollectionEvent, { saved: number; duplicates: number }> {
  const names = namesInQuery(job.query, company.keywords);
  const inSubreddits = names.length === 0 && isSubredditSearch(job.query) && subreddits.length > 0;
  const searchIn = inSubreddits ? subredditsForOneSearch(job.query, subreddits) : undefined;
  const where = searchIn ? ` in ${searchIn.length} subreddits` : "";
  yield { type: "fetching", query: job.query, message: `Searching Reddit: ${job.query}${where}` };

  try {
    const search = (query: string, timeframe: "week" | "month" | "year") =>
      searchReddit(query, {
        // A search returns only a few posts, so they should be the best matches.
        // Sorting by newest filled the slots with passing mentions from the last day.
        sort: "relevance",
        timeframe,
        limit: 100,
        subreddits: searchIn,
        // The queue does its own waiting, so a limit shows up at once.
        retryThrottles: false,
      });

    // Some markets have too few posts for any one week. An empty search costs
    // nothing, so a topic widens until it first finds something, then looks only
    // at the past week, so no run pays again for the same old posts.
    //
    // Each finished step is remembered. Starting over after a rate limit used the
    // whole allowance on steps already done, so the search never got further.
    let posts: RedditPostRaw[] = [];
    let widenedTo: string | null = null;
    let step = emptySteps.get(job.id) ?? 0;
    if (step === 0) {
      posts = await search(job.query, "week");
      if (posts.length === 0 && names.length === 0 && !(await hasFoundPosts(db, company.id, job.query))) {
        step = 1;
        emptySteps.set(job.id, step);
      }
    }
    while (step > 0 && posts.length === 0 && step <= WIDER_WINDOWS.length) {
      await sleep(collectorConfig.delayBetweenQueriesMs);
      const timeframe = WIDER_WINDOWS[step - 1]!;
      posts = await search(withoutBuyingWords(job.query), timeframe);
      if (posts.length > 0) {
        widenedTo = timeframe;
      } else {
        step += 1;
        emptySteps.set(job.id, step);
      }
    }
    // Search can return posts that never use the name. Those are not paid for twice.
    const usable = names.length > 0 ? posts.filter((post) => namesPost(post, names)) : posts;
    const withoutName = posts.length - usable.length;
    const tagged = usable.map((post) => ({ ...post, matchedQuery: job.query }));
    const split = await splitNewPosts(db, company.id, tagged, seenIds);
    const stored = await saveNewPosts(db, company, split.freshPosts);
    const duplicates = split.duplicates + stored.duplicates;

    await creditRepeatFinds(db, runId, company, job.query, usable.map((post) => post.id));
    await completeSearch(db, job.id, { fetched: posts.length, fresh: stored.saved, duplicates });
    stats.totalFetched += posts.length;
    stats.totalNew += stored.saved;
    stats.errorCount += stored.errors;
    // A run that is getting work done is not in a crash loop.
    await db.collectionRun.update({ where: { id: runId }, data: { ...stats, resumeCount: 0 } });

    yield {
      type: "fetched",
      query: job.query,
      count: posts.length,
      message: `Found ${posts.length} posts for ${job.query}${widenedTo ? ` from the past ${widenedTo}` : ""} (${stored.saved} new, ${duplicates} duplicates${withoutName > 0 ? `, ${withoutName} without the name` : ""})`,
    };
    if (stored.errors > 0) {
      yield {
        type: "error",
        error: `${stored.errors} posts could not be saved: ${stored.firstError}`,
        message: `Some posts for ${job.query} were skipped and will be retried next run`,
      };
    }
    return { saved: stored.saved, duplicates };
  } catch (error) {
    if (error instanceof ProviderWaitError) {
      const until = await holdQueue(db, runId, job, error);
      if (until) {
        yield {
          type: "waiting",
          until,
          message: `${error.message} The searches wait ${waitWords(until)}, then continue with ${job.query}.`,
        };
        return { saved: 0, duplicates: 0 };
      }
    }

    stats.errorCount++;
    const message = error instanceof Error ? error.message : "Unknown";
    await failSearch(db, job.id, message);
    yield {
      type: "error",
      error: `Failed to search ${job.query}: ${message}`,
      message: `Error searching ${job.query}`,
    };
    return { saved: 0, duplicates: 0 };
  }
}

/**
 * Classifies saved posts as they arrive, several at a time, until the searches
 * have finished and nothing is left. Each post stands alone. A rate limit delays
 * only that post, and a failure uses up only that post's attempts. Never searches Reddit.
 */
async function classifyLane(
  db: PrismaClient,
  company: ClassifyCompany,
  runId: string,
  stats: CollectionStats,
  emit: (event: CollectionEvent) => void,
  searchesFinished: () => boolean,
): Promise<void> {
  const context: ClassifyContext = {
    db,
    company,
    runId,
    stats,
    emit,
    // Constant for the whole run, so worked out once.
    goals: parseGoals(company.goals),
    trackedNames: [company.name, ...company.keywords.flatMap((keyword) =>
      keyword.type === "topic" ? [] : [keyword.value, ...aliasList(keyword.aliases)],
    )],
    leftForNextRun: new Set(),
    waits: new Map(),
    failureStreak: 0,
    stopped: false,
  };
  const inFlight = new Map<string, Promise<void>>();

  const waitingPosts = () => ({
    companyId: company.id,
    status: "pending",
    classifyAttempts: { lt: MAX_CLASSIFY_ATTEMPTS },
    id: { notIn: [...inFlight.keys(), ...context.leftForNextRun] },
  });

  for (;;) {
    // Read first, so a post saved just before the searches end is still seen.
    const noMoreSearches = searchesFinished();
    const room = collectorConfig.classifyConcurrency - inFlight.size;
    const now = new Date();

    const ready = !context.stopped && room > 0
      ? await db.redditPost.findMany({
          omit: { rawJson: true },
          where: { ...waitingPosts(), OR: [{ classifyRetryAt: null }, { classifyRetryAt: { lte: now } }] },
          orderBy: { redditCreatedAt: "desc" },
          take: room,
        })
      : [];

    for (const post of ready) {
      const task = classifyOne(context, post)
        .catch((error: unknown) => {
          // Only a failed database write gets here. The post stays pending for the next run.
          context.leftForNextRun.add(post.id);
          console.error(`[classify] ${error instanceof Error ? error.message : "Unknown"}`);
        })
        .finally(() => {
          inFlight.delete(post.id);
        });
      inFlight.set(post.id, task);
    }

    if (inFlight.size === 0 && ready.length === 0) {
      if (context.stopped) return;
      if (noMoreSearches) {
        // Counted after the last post finished, so a post that was in progress
        // during the query above, or whose wait just ended, is not left behind.
        const remaining = await db.redditPost.count({
          where: {
            ...waitingPosts(),
            OR: [
              { classifyRetryAt: null },
              { classifyRetryAt: { lte: new Date(Date.now() + LONGEST_CLASSIFY_WAIT_MS) } },
            ],
          },
        });
        if (remaining === 0) return;
      }
    }

    await Promise.race([sleep(collectorConfig.classifyPollMs), ...inFlight.values()]);
  }
}

interface ClassifyContext {
  db: PrismaClient;
  company: ClassifyCompany;
  runId: string;
  stats: CollectionStats;
  emit: (event: CollectionEvent) => void;
  goals: ReturnType<typeof parseGoals>;
  trackedNames: string[];
  /** Posts this run will not try again. They stay pending. */
  leftForNextRun: Set<string>;
  /** Rate limits per post in this run. */
  waits: Map<string, number>;
  failureStreak: number;
  /** Many real failures in a row, so the service is down and more tries would use up attempts. */
  stopped: boolean;
}

type PendingPost = Awaited<ReturnType<PrismaClient["redditPost"]["findMany"]>>[number];

async function classifyOne(context: ClassifyContext, post: Omit<PendingPost, "rawJson">): Promise<void> {
  const { db, company, runId, stats, emit, goals, trackedNames } = context;
  emit({
    type: "classifying",
    postTitle: post.title.slice(0, 60),
    message: `Classifying "${post.title.slice(0, 50)}..."`,
  });

  const keywordTracked = trackedKeyword(post.matchedQuery, company.keywords, company.name);
  const searchesThatFound = (row: { matchedQuery: string | null; matchedQueries: string }) => [...new Set([
    ...(row.matchedQuery ? [row.matchedQuery] : []),
    ...aliasList(row.matchedQueries),
  ])];
  try {
    for (const query of searchesThatFound(post)) {
      await linkPostKeywords(db, post.id, query, company.keywords, `${post.title} ${post.body}`);
    }
    const classification: ClassificationResult = await classifyPost({
      title: post.title,
      body: post.body,
      subreddit: post.subreddit,
      companyName: company.name,
      numComments: post.numComments,
      redditScore: post.redditScore,
      postedAt: post.redditCreatedAt,
      goals,
      keywords: company.keywords,
      brief: {
        product: company.product,
        buyer: company.buyer,
        keepWhen: company.keepWhen,
        notAbout: company.notAbout,
      },
    });

    const decision = judgeDecision({
      score: classification.relevanceScore,
      threshold: classification.trace?.threshold ?? 0.7,
      evidence: sessionEvidence(post, company),
      keepWhen: company.keepWhen,
      sentiment: classification.sentiment,
      sentimentConfidence: classification.sentimentConfidence,
      requestScore: classification.relevanceScores?.matches_request,
    });
    const held = classification.isRelevant && decision.verdict !== "show";

    let reason: string | null = null;
    if (classification.isRelevant) {
      emit({
        type: "summarizing",
        current: stats.totalRelevant + 1,
        total: stats.totalRelevant + 1,
        message: `Writing the one-line reason for "${post.title.slice(0, 50)}"`,
      });
      reason = await writeReason({
        post: { title: post.title, body: post.body, subreddit: post.subreddit },
        companyName: company.name,
        category: classification.category,
        keepWhen: company.keepWhen,
        names: trackedNames,
      });
    }

    const saved = await db.redditPost.update({
      where: { id: post.id },
      data: {
        isRelevant: classification.isRelevant,
        relevanceScore: classification.relevanceScore,
        // Category, sentiment, and urgency describe how the team should act.
        // A post that failed the filter has none of those.
        category: classification.isRelevant ? classification.category : null,
        categoryConfidence: classification.isRelevant ? classification.categoryConfidence : null,
        sentiment: classification.isRelevant ? classification.sentiment : null,
        sentimentConfidence: classification.isRelevant ? classification.sentimentConfidence : null,
        urgency: classification.isRelevant ? classification.urgency : null,
        urgencyRaw: classification.isRelevant ? classification.urgencyRaw : null,
        audienceTag: classification.isRelevant ? classification.audienceTag : null,
        reason,
        // A post the checks do not back up waits for a person to confirm it.
        status: classification.isRelevant ? (held ? "review" : "new") : "filtered",
        classifiedAt: new Date(),
        classifyRetryAt: null,
      },
    });
    await logClassification(db, {
      companyId: company.id,
      postId: post.id,
      runId,
      keywordTracked,
      claim: classification.trace?.claim ?? "",
      state: classification.trace?.state ?? "",
      threshold: classification.trace?.threshold ?? 0,
      relevanceScore: classification.relevanceScore,
      isRelevant: classification.isRelevant,
      category: classification.category,
      categoryConfidence: classification.categoryConfidence,
      sentiment: classification.sentiment,
      urgencyRaw: classification.urgencyRaw,
      audience: classification.audienceTag,
      reason,
      answersJson: JSON.stringify({
        answers: classification.trace?.answers ?? null,
        relevanceScores: classification.relevanceScores ?? null,
        verdict: decision.verdict,
        borderline: decision.borderline,
        checks: decision.checks,
        evidence: decision.evidence,
      }),
    });
    context.failureStreak = 0;
    stats.totalClassified++;
    if (classification.isRelevant) stats.totalRelevant++;
    else stats.totalFiltered++;
    await saveProgress(db, runId, stats);
    // Read from the saved row, because a search can find this post while it is being classified.
    for (const query of searchesThatFound(saved)) {
      await recordSearchOutcome(db, runId, query, classification.isRelevant, company.id);
    }

    emit({
      type: "classified",
      postTitle: post.title.slice(0, 60),
      category: classification.category,
      isRelevant: classification.isRelevant,
      message: `${classification.isRelevant ? "✓" : "✗"} ${classification.category} — "${post.title.slice(0, 40)}..."`,
    });
  } catch (error) {
    const limit = rateLimitWait(error);
    if (limit) {
      // Being rate limited says nothing about the post, so it uses up no attempts.
      const waits = (context.waits.get(post.id) ?? 0) + 1;
      context.waits.set(post.id, waits);
      const waitMs = limit.retryAfterMs ?? FIRST_CLASSIFY_WAIT_MS * 2 ** (waits - 1);
      const until = new Date(Date.now() + waitMs);
      if (waits >= MAX_CLASSIFY_WAITS_PER_RUN || waitMs > LONGEST_CLASSIFY_WAIT_MS) {
        context.leftForNextRun.add(post.id);
      }
      await db.redditPost.update({ where: { id: post.id }, data: { classifyRetryAt: until } });
      emit({
        type: "post_waiting",
        until,
        message: `Rate limited on "${post.title.slice(0, 40)}...". This post retries in ${waitWords(until)}. Other posts carry on.`,
      });
      return;
    }

    context.leftForNextRun.add(post.id);
    stats.errorCount++;
    const attempts = post.classifyAttempts + 1;
    await db.redditPost.update({
      where: { id: post.id },
      data: {
        classifyAttempts: attempts,
        status: attempts >= MAX_CLASSIFY_ATTEMPTS ? "error" : "pending",
      },
    });
    await logClassification(db, {
      companyId: company.id,
      postId: post.id,
      runId,
      keywordTracked,
      claim: "",
      state: "",
      threshold: 0,
      error: `Attempt ${attempts}/${MAX_CLASSIFY_ATTEMPTS}: ${error instanceof Error ? error.message : "Unknown"}`.slice(0, 500),
    });
    emit({
      type: "error",
      error: `Classification failed for "${post.title.slice(0, 40)}" (attempt ${attempts}/${MAX_CLASSIFY_ATTEMPTS}): ${error instanceof Error ? error.message : "Unknown"}`,
      message: `Error classifying post`,
    });

    context.failureStreak++;
    if (context.failureStreak >= MAX_CONSECUTIVE_CLASSIFY_FAILURES && !context.stopped) {
      context.stopped = true;
      emit({
        type: "error",
        error: `${context.failureStreak} classifications failed in a row`,
        message: "Classification paused. Remaining posts stay pending for the next run",
      });
    }
  }
}

type ClassificationLogRow = Parameters<PrismaClient["classificationLog"]["create"]>[0]["data"];

/** A failed log write must never undo a classification that was saved. */
async function logClassification(db: PrismaClient, data: ClassificationLogRow) {
  try {
    await db.classificationLog.create({ data });
  } catch (error) {
    console.warn(
      "[classify] could not write the classification log:",
      error instanceof Error ? error.message : "Unknown",
    );
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function decimal(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function flag(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Whether a post found by a name search actually uses one of the names. */
function namesPost(post: RedditPostRaw, names: string[]): boolean {
  const content = `${post.title} ${post.selftext ?? ""} ${post.url} ${post.subreddit}`;
  return names.some((name) => mentionsName(content, name));
}

/**
 * Records a search on posts an earlier search already saved, so its keyword
 * tags and results are not lost to deduplication. Posts still waiting are
 * credited when they are classified.
 */
async function creditRepeatFinds(
  db: PrismaClient,
  runId: string,
  company: { id: string; keywords: { id: string; type: string; value: string; aliases: string }[] },
  query: string,
  redditIds: string[],
): Promise<void> {
  if (redditIds.length === 0) return;
  const saved = await db.redditPost.findMany({
    where: { companyId: company.id, redditId: { in: redditIds } },
    select: { id: true, title: true, body: true, matchedQuery: true, matchedQueries: true, isRelevant: true },
  });

  for (const post of saved) {
    const known = aliasList(post.matchedQueries);
    if (post.matchedQuery === query || known.includes(query)) continue;

    await db.redditPost.update({
      where: { id: post.id },
      data: { matchedQueries: JSON.stringify([...known, query]) },
    });
    await linkPostKeywords(db, post.id, query, company.keywords, `${post.title} ${post.body}`);
    if (post.isRelevant !== null) {
      await recordSearchOutcome(db, runId, query, post.isRelevant, company.id);
    }
  }
}

async function splitNewPosts(
  db: PrismaClient,
  companyId: string,
  posts: RedditPostRaw[],
  seenIds: Set<string>,
) {
  const ids = posts.map((post) => post.id);
  const existing = ids.length
    ? await db.redditPost.findMany({
        where: { companyId, redditId: { in: ids } },
        select: { redditId: true },
      })
    : [];
  const known = new Set(existing.map((post) => post.redditId));

  // The same author sharing the same title across subreddits is one post, not several leads.
  const named = posts.filter((post) => post.author && post.author !== "[deleted]");
  const sharedElsewhere = named.length
    ? await db.redditPost.findMany({
        where: {
          companyId,
          redditId: { notIn: ids },
          OR: named.map((post) => ({ author: post.author, title: post.title })),
        },
        select: { author: true, title: true },
      })
    : [];
  const sharedKey = (post: { author: string; title: string }) =>
    `shared:${post.author}:${post.title.trim().toLowerCase()}`;
  for (const post of sharedElsewhere) known.add(sharedKey(post));

  const freshPosts: RedditPostRaw[] = [];
  let duplicates = 0;

  for (const post of posts) {
    const key = post.author && post.author !== "[deleted]" ? sharedKey(post) : null;
    if (known.has(post.id) || seenIds.has(post.id) || (key && (known.has(key) || seenIds.has(key)))) {
      duplicates += 1;
      continue;
    }
    seenIds.add(post.id);
    if (key) seenIds.add(key);
    freshPosts.push(post);
  }

  return { freshPosts, duplicates };
}

/**
 * Saves one post. A post that another run saved first counts as a
 * duplicate instead of an error, so two overlapping workers stay correct.
 */
async function storePost(
  db: PrismaClient,
  companyId: string,
  rawPost: RedditPostRaw,
): Promise<{ id: string } | "duplicate"> {
  const source = recordOf(rawPost.raw);

  try {
    return await db.redditPost.create({
      data: {
        companyId,
        redditId: rawPost.id,
        title: rawPost.title,
        body: rawPost.selftext ?? "",
        subreddit: rawPost.subreddit,
        author: rawPost.author,
        authorFullname: text(source.author_fullname),
        url: rawPost.url,
        permalink: rawPost.permalink.startsWith("http")
          ? rawPost.permalink
          : `https://reddit.com${rawPost.permalink}`,
        redditScore: rawPost.score,
        numComments: rawPost.num_comments,
        ups: integer(source.ups),
        upvoteRatio: decimal(source.upvote_ratio),
        numCrossposts: integer(source.num_crossposts),
        totalAwards: integer(source.total_awards_received),
        isSelf: rawPost.is_self,
        isNsfw: flag(source.is_nsfw),
        isSpoiler: flag(source.is_spoiler),
        isStickied: flag(source.is_stickied),
        locked: flag(source.locked),
        archived: flag(source.archived),
        flair: rawPost.link_flair_text ?? text(source.link_flair_text),
        domain: text(source.domain),
        searchSnippet: text(source.search_snippet),
        subredditId: text(source.subreddit_id),
        matchedQuery: rawPost.matchedQuery ?? null,
        matchedQueries: JSON.stringify(rawPost.matchedQuery ? [rawPost.matchedQuery] : []),
        rawJson: JSON.stringify(rawPost.raw ?? rawPost),
        redditCreatedAt: new Date(rawPost.created_utc * 1000),
        status: "pending",
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return "duplicate";
    throw error;
  }
}

async function saveProgress(db: PrismaClient, runId: string, stats: CollectionStats) {
  await db.collectionRun.update({ where: { id: runId }, data: { ...stats } });
}

/** Appends a log entry to a collection run. */
async function logToRun(
  db: PrismaClient,
  runId: string,
  type: string,
  message: string,
) {
  await db.collectionLog.create({
    data: { runId, type, message },
  });
}
