/**
 * The classification track of a run: labels saved posts as they arrive, several
 * at a time. Each post stands alone, so a rate limit delays only that post and a
 * failure uses up only that post's attempts.
 *
 * @module services/classify-lane
 */

import { judgeDecision, sessionEvidence, type FilterDecision } from "@/lib/filter-checks";
import { parseGoals } from "@/lib/goals";
import { aliasList, trackedKeyword } from "@/lib/post-tags";
import { rateLimitWait } from "@/lib/rate-limit";
import { classifyPost, type ClassificationResult } from "./classifier";
import {
  collectorConfig,
  saveProgress,
  waitWords,
  type ClassifyCompany,
  type CollectionEvent,
  type CollectionStats,
  type PrismaClient,
} from "./collection-shared";
import { linkPostKeywords } from "./post-tags";
import { writeReason } from "./reason";
import { sleep } from "./reddit/http";
import { recordSearchOutcome } from "./search-queue";

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

/**
 * Classifies saved posts as they arrive, several at a time, until the searches
 * have finished and nothing is left. Each post stands alone. A rate limit delays
 * only that post, and a failure uses up only that post's attempts. Never searches Reddit.
 */
export async function classifyLane(
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

type Post = Omit<Awaited<ReturnType<PrismaClient["redditPost"]["findMany"]>>[number], "rawJson">;

/** The searches that found a post, without repeats. */
function searchesThatFound(row: { matchedQuery: string | null; matchedQueries: string }): string[] {
  return [...new Set([...(row.matchedQuery ? [row.matchedQuery] : []), ...aliasList(row.matchedQueries)])];
}

async function classifyOne(context: ClassifyContext, post: Post): Promise<void> {
  const { db, company, runId, stats, emit, goals, trackedNames } = context;
  emit({
    type: "classifying",
    postTitle: post.title.slice(0, 60),
    message: `Classifying "${post.title.slice(0, 50)}..."`,
  });

  const keywordTracked = trackedKeyword(post.matchedQuery, company.keywords, company.name);
  try {
    for (const query of searchesThatFound(post)) {
      await linkPostKeywords(db, post.id, query, company.keywords, `${post.title} ${post.body}`);
    }
    const classification = await classifyPost({
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

    const saved = await saveVerdict(db, post.id, classification, decision, reason);
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
    if (limit) await delayPost(context, post, limit.retryAfterMs);
    else await recordFailure(context, post, keywordTracked, error);
  }
}

/** Stores what the classifier decided. */
function saveVerdict(
  db: PrismaClient,
  postId: string,
  classification: ClassificationResult,
  decision: FilterDecision,
  reason: string | null,
) {
  const { isRelevant } = classification;
  // A post the checks do not back up waits for a person to confirm it.
  const held = isRelevant && decision.verdict !== "show";
  return db.redditPost.update({
    where: { id: postId },
    data: {
      isRelevant,
      relevanceScore: classification.relevanceScore,
      // Category, sentiment, and urgency describe how the team should act.
      // A post that failed the filter has none of those.
      category: isRelevant ? classification.category : null,
      categoryConfidence: isRelevant ? classification.categoryConfidence : null,
      sentiment: isRelevant ? classification.sentiment : null,
      sentimentConfidence: isRelevant ? classification.sentimentConfidence : null,
      urgency: isRelevant ? classification.urgency : null,
      urgencyRaw: isRelevant ? classification.urgencyRaw : null,
      audienceTag: isRelevant ? classification.audienceTag : null,
      reason,
      status: isRelevant ? (held ? "review" : "new") : "filtered",
      classifiedAt: new Date(),
      classifyRetryAt: null,
    },
  });
}

/** Being rate limited says nothing about the post, so it waits and uses up no attempts. */
async function delayPost(context: ClassifyContext, post: Post, retryAfterMs: number | null): Promise<void> {
  const waits = (context.waits.get(post.id) ?? 0) + 1;
  context.waits.set(post.id, waits);
  const waitMs = retryAfterMs ?? FIRST_CLASSIFY_WAIT_MS * 2 ** (waits - 1);
  const until = new Date(Date.now() + waitMs);
  if (waits >= MAX_CLASSIFY_WAITS_PER_RUN || waitMs > LONGEST_CLASSIFY_WAIT_MS) {
    context.leftForNextRun.add(post.id);
  }
  await context.db.redditPost.update({ where: { id: post.id }, data: { classifyRetryAt: until } });
  context.emit({
    type: "post_waiting",
    until,
    message: `Rate limited on "${post.title.slice(0, 40)}...". This post retries in ${waitWords(until)}. Other posts carry on.`,
  });
}

/** A real failure uses up one of the post's attempts. Many in a row stop classification for this run. */
async function recordFailure(context: ClassifyContext, post: Post, keywordTracked: string, error: unknown): Promise<void> {
  const { db, company, runId, stats, emit } = context;
  const message = error instanceof Error ? error.message : "Unknown";
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
    error: `Attempt ${attempts}/${MAX_CLASSIFY_ATTEMPTS}: ${message}`.slice(0, 500),
  });
  emit({
    type: "error",
    error: `Classification failed for "${post.title.slice(0, 40)}" (attempt ${attempts}/${MAX_CLASSIFY_ATTEMPTS}): ${message}`,
    message: "Error classifying post",
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
