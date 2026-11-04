import type { db as dbType } from "~/server/db";
type PrismaClient = typeof dbType;
import { searchReddit, type RedditPostRaw } from "./reddit";
import { classifyPost, type ClassificationResult } from "./classifier";
import { generatePostReason } from "./openai";

const DELAY_BETWEEN_QUERIES = 700;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type CollectionEvent =
  | { type: "started"; message: string }
  | { type: "fetching"; query: string; message: string }
  | { type: "fetched"; query: string; count: number; message: string }
  | { type: "dedup"; totalNew: number; totalSkipped: number; message: string }
  | { type: "classifying"; current: number; total: number; message: string }
  | { type: "classified"; postTitle: string; category: string; isRelevant: boolean; message: string }
  | { type: "summarizing"; current: number; total: number; message: string }
  | { type: "completed"; stats: CollectionStats; message: string }
  | { type: "error"; error: string; message: string };

export interface CollectionStats {
  totalFetched: number;
  totalNew: number;
  totalClassified: number;
  totalRelevant: number;
  totalFiltered: number;
  errorCount: number;
}

export async function* runCollection(
  db: PrismaClient,
  companyId: string,
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

  const run = await db.collectionRun.create({
    data: { companyId, status: "running" },
  });

  const stats: CollectionStats = {
    totalFetched: 0,
    totalNew: 0,
    totalClassified: 0,
    totalRelevant: 0,
    totalFiltered: 0,
    errorCount: 0,
  };

  yield { type: "started", message: `Collection started for ${company.name}` };

  try {
    // Step 1: Build search queries
    const queries = company.searchQueries.map((sq) => sq.query);
    if (queries.length === 0) {
      yield { type: "error", error: "No search queries configured", message: "No search queries" };
      return;
    }

    // Step 2: Fetch from Reddit
    const allRawPosts: RedditPostRaw[] = [];
    const subreddits = company.subreddits.map((s) => s.name);

    for (const query of queries) {
      yield { type: "fetching", query, message: `Searching Reddit: "${query}"` };

      try {
        if (subreddits.length > 0) {
          for (const sub of subreddits) {
            const posts = await searchReddit(query, {
              sort: "new",
              timeframe: "week",
              limit: 25,
              subreddit: sub,
            });
            allRawPosts.push(...posts);
            await sleep(DELAY_BETWEEN_QUERIES);
          }
        }

        const globalPosts = await searchReddit(query, {
          sort: "new",
          timeframe: "week",
          limit: 50,
        });
        allRawPosts.push(...globalPosts);

        stats.totalFetched = allRawPosts.length;
        yield {
          type: "fetched",
          query,
          count: globalPosts.length,
          message: `Found ${globalPosts.length} posts for "${query}"`,
        };
      } catch (error) {
        stats.errorCount++;
        yield {
          type: "error",
          error: `Failed to search "${query}": ${error instanceof Error ? error.message : "Unknown"}`,
          message: `Error searching "${query}"`,
        };
      }

      await sleep(DELAY_BETWEEN_QUERIES);
    }

    // Step 3: Deduplicate
    const uniquePosts = new Map<string, RedditPostRaw>();
    for (const post of allRawPosts) {
      if (!uniquePosts.has(post.id)) {
        uniquePosts.set(post.id, post);
      }
    }

    const newPosts: RedditPostRaw[] = [];
    for (const post of uniquePosts.values()) {
      const existing = await db.redditPost.findUnique({
        where: { redditId: post.id },
      });
      if (!existing) {
        newPosts.push(post);
      }
    }

    stats.totalNew = newPosts.length;
    const totalSkipped = uniquePosts.size - newPosts.length;

    yield {
      type: "dedup",
      totalNew: newPosts.length,
      totalSkipped,
      message: `${newPosts.length} new posts (${totalSkipped} duplicates skipped)`,
    };

    await logToRun(db, run.id, "fetch", `Fetched ${stats.totalFetched} raw, ${uniquePosts.size} unique, ${newPosts.length} new`);

    // Step 4: Store new posts
    for (const rawPost of newPosts) {
      await db.redditPost.create({
        data: {
          redditId: rawPost.id,
          title: rawPost.title,
          body: rawPost.selftext ?? "",
          subreddit: rawPost.subreddit,
          author: rawPost.author,
          url: rawPost.url,
          permalink: `https://reddit.com${rawPost.permalink}`,
          redditScore: rawPost.score,
          numComments: rawPost.num_comments,
          isSelf: rawPost.is_self,
          redditCreatedAt: new Date(rawPost.created_utc * 1000),
          status: "pending",
        },
      });
    }

    // Step 5: Classify with Jev
    const pendingPosts = await db.redditPost.findMany({
      where: { status: "pending" },
      orderBy: { redditCreatedAt: "desc" },
    });

    for (let i = 0; i < pendingPosts.length; i++) {
      const post = pendingPosts[i]!;
      yield {
        type: "classifying",
        current: i + 1,
        total: pendingPosts.length,
        message: `Classifying ${i + 1}/${pendingPosts.length}: "${post.title.slice(0, 50)}..."`,
      };

      try {
        const classification: ClassificationResult = await classifyPost({
          title: post.title,
          body: post.body,
          subreddit: post.subreddit,
          companyName: company.name,
          keywordTracked: company.name,
        });

        stats.totalClassified++;

        if (classification.isRelevant) {
          stats.totalRelevant++;
        } else {
          stats.totalFiltered++;
        }

        await db.redditPost.update({
          where: { id: post.id },
          data: {
            isRelevant: classification.isRelevant,
            relevanceScore: classification.relevanceScore,
            category: classification.category,
            categoryConfidence: classification.categoryConfidence,
            sentiment: classification.sentiment,
            sentimentConfidence: classification.sentimentConfidence,
            urgency: classification.urgency,
            urgencyRaw: classification.urgencyRaw,
            status: classification.isRelevant ? "new" : "filtered",
            classifiedAt: new Date(),
          },
        });

        yield {
          type: "classified",
          postTitle: post.title.slice(0, 60),
          category: classification.category,
          isRelevant: classification.isRelevant,
          message: `${classification.isRelevant ? "✓" : "✗"} ${classification.category} — "${post.title.slice(0, 40)}..."`,
        };
      } catch (error) {
        stats.errorCount++;
        await db.redditPost.update({
          where: { id: post.id },
          data: { status: "error" },
        });
        yield {
          type: "error",
          error: `Classification failed for "${post.title.slice(0, 40)}": ${error instanceof Error ? error.message : "Unknown"}`,
          message: `Error classifying post`,
        };
      }
    }

    await logToRun(db, run.id, "classify", `Classified ${stats.totalClassified}: ${stats.totalRelevant} relevant, ${stats.totalFiltered} filtered`);

    // Step 6: Generate one-liner reasons (GPT-4o-mini, only for relevant)
    const relevantPosts = await db.redditPost.findMany({
      where: { isRelevant: true, reason: null, status: "new" },
    });

    for (let i = 0; i < relevantPosts.length; i++) {
      const post = relevantPosts[i]!;
      yield {
        type: "summarizing",
        current: i + 1,
        total: relevantPosts.length,
        message: `Generating summary ${i + 1}/${relevantPosts.length}`,
      };

      try {
        const reason = await generatePostReason(
          { title: post.title, body: post.body, subreddit: post.subreddit },
          company.name,
          post.category ?? "other",
        );

        await db.redditPost.update({
          where: { id: post.id },
          data: { reason },
        });
      } catch (error) {
        stats.errorCount++;
        console.error("Summary generation error:", error);
      }
    }

    await logToRun(db, run.id, "summarize", `Generated ${relevantPosts.length} summaries`);

    // Complete the run
    await db.collectionRun.update({
      where: { id: run.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        totalFetched: stats.totalFetched,
        totalNew: stats.totalNew,
        totalClassified: stats.totalClassified,
        totalRelevant: stats.totalRelevant,
        totalFiltered: stats.totalFiltered,
        errorCount: stats.errorCount,
      },
    });

    yield {
      type: "completed",
      stats,
      message: `Collection complete! ${stats.totalNew} new posts, ${stats.totalRelevant} relevant.`,
    };
  } catch (error) {
    await db.collectionRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        completedAt: new Date(),
        ...stats,
      },
    });

    yield {
      type: "error",
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Collection failed",
    };
  }
}

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
