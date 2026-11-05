/**
 * The search track of a run: works through the queue one search at a time,
 * deduplicates, and saves new posts as pending. A rate limit here pauses only
 * the searches, so classification carries on.
 *
 * @module services/search-lane
 */

import { mentionsName } from "@/lib/filter-checks";
import { aliasList, namesInQuery } from "@/lib/post-tags";
import {
  collectorConfig,
  logToRun,
  waitWords,
  type ClassifyCompany,
  type CollectionEvent,
  type CollectionStats,
  type PrismaClient,
} from "./collection-shared";
import { linkPostKeywords } from "./post-tags";
import {
  isSubredditSearch,
  searchReddit,
  subredditsForOneSearch,
  withoutBuyingWords,
  type RedditPostRaw,
} from "./reddit";
import { ProviderWaitError, sleep } from "./reddit/http";
import { claimNextSearch, completeSearch, failSearch, holdQueue, recordSearchOutcome, sitOutHold } from "./search-queue";

/**
 * Runs the search queue. A wait here pauses only the searches, so posts already
 * saved keep being classified.
 */
export async function* searchLane(
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

/**
 * The searches this run pays for. The company's own name and hand-written
 * searches always run. A subreddit search needs subreddits, and a search that
 * has found nothing useful sits out. If that would leave nothing, all of them run.
 */
export function planSearches(
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
        limit: collectorConfig.maxPostsPerSearch,
        subreddits: searchIn,
        // The queue does its own waiting, so a limit shows up at once.
        retryThrottles: false,
      }).then((found) => found.slice(0, collectorConfig.maxPostsPerSearch));

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

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
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
