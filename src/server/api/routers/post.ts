/**
 * Post (Feed) tRPC Router
 *
 * Provides feed data, status mutations, aggregate statistics, and
 * recent activity logs for the main app dashboard and feed views.
 *
 * Procedures:
 * - {@link getFeed} — Cursor-paginated, filterable feed of relevant posts.
 * - {@link updateStatus} — Mark a post as handled / dismissed / new.
 * - {@link getStats} — Aggregate counts + category/sentiment breakdowns.
 * - {@link getRecentActivity} — Latest `CollectionLog` entries.
 *
 * @module api/routers/post
 */

import type { Prisma } from "@generated/prisma";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { env } from "@/env";
import { buildFeedWhere, RELEVANT_STATUSES } from "@/lib/feed-filter";
import { measureFilter } from "@/lib/filter-checks";
import { postMentions } from "@/lib/mentions";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { activeSessionId } from "@/server/services/active-session";

const NO_SESSION = "__none__";
/** The most posts by one author shown when a post is opened. */
const AUTHOR_HISTORY_LIMIT = 20;
const DELETED_AUTHOR = "[deleted]";

/** The author's posts a person can see. A dismissed post never comes back. */
const authorPostsWhere = (companyId: string) => ({
  companyId,
  status: { not: "dismissed" },
  author: { not: DELETED_AUTHOR },
});

export const postRouter = createTRPCRouter({
  /**
   * Returns a cursor-paginated feed of relevant posts.
   *
   * Dismissed posts are **always** excluded. The default view is relevant posts
   * only. `relevance: "filtered"` shows posts that were saved but did not pass
   * the filter. Results are ordered by urgency (desc) then creation date (desc).
   *
   * @param input.category   - Filter by category string (optional).
   * @param input.sentiment  - Filter by sentiment string (optional).
   * @param input.minUrgency - Minimum urgency level 1–5 (optional).
   * @param input.status     - `"new"` | `"handled"` | `"all"` (default `"new"`).
   * @param input.relevance  - `"relevant"` | `"filtered"` | `"all"` (default `"relevant"`).
   * @param input.cursor     - Pagination cursor (post ID from previous page).
   * @param input.limit      - Page size 1–50 (default 20).
   * @returns `{ posts, nextCursor }` — posts array and optional next cursor.
   */
  getFeed: publicProcedure
    .input(
      z.object({
        category: z.string().optional(),
        sentiment: z.string().optional(),
        minUrgency: z.number().min(1).max(5).optional(),
        status: z.enum(["new", "handled", "all"]).default("new"),
        relevance: z.enum(["relevant", "review", "filtered", "waiting", "all"]).default("relevant"),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const companyId = (await activeSessionId(ctx)) ?? NO_SESSION;
      const posts = await ctx.db.redditPost.findMany({
        omit: { rawJson: true },
        include: { authorProfile: { select: { displayName: true, iconUrl: true } } },
        where: { ...(buildFeedWhere(input) as Prisma.RedditPostWhereInput), companyId },
        orderBy: [{ urgency: "desc" }, { redditCreatedAt: "desc" }, { id: "asc" }],
        take: input.limit + 1,
        // The cursor is the extra row fetched for the next page, so the next
        // page starts at it. Skipping it would drop one post per page.
        ...(input.cursor ? { cursor: { id: input.cursor } } : {}),
      });

      let nextCursor: string | undefined;
      if (posts.length > input.limit) {
        const nextItem = posts.pop();
        nextCursor = nextItem?.id;
      }

      const [keywords, postCounts] = await Promise.all([
        ctx.db.keyword.findMany({ where: { companyId } }),
        ctx.db.redditPost.groupBy({
          by: ["author"],
          where: {
            ...authorPostsWhere(companyId),
            author: { in: posts.map((post) => post.author), not: DELETED_AUTHOR },
          },
          _count: true,
        }),
      ]);
      const countByAuthor = new Map(postCounts.map((row) => [row.author, row._count]));

      return {
        posts: posts.map((post) => ({
          ...post,
          mentions: postMentions(post, keywords),
          authorPostCount: countByAuthor.get(post.author) ?? 1,
        })),
        nextCursor,
      };
    }),

  /**
   * One post with its author's details, what it mentions, and the author's
   * other saved posts in this session. Read from saved data, so it costs no credits.
   */
  getPostDetail: publicProcedure
    .input(z.object({ postId: z.string() }))
    .query(async ({ ctx, input }) => {
      const companyId = (await activeSessionId(ctx)) ?? NO_SESSION;
      const post = await ctx.db.redditPost.findFirst({
        omit: { rawJson: true },
        where: { id: input.postId, companyId },
        include: { authorProfile: { omit: { rawJson: true } } },
      });
      if (!post) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post not found in this session." });
      }

      const sameAuthor = {
        ...authorPostsWhere(companyId),
        author: post.author === DELETED_AUTHOR ? { in: [] } : post.author,
        id: { not: post.id },
      };
      const [keywords, otherPosts, otherPostCount] = await Promise.all([
        ctx.db.keyword.findMany({ where: { companyId } }),
        ctx.db.redditPost.findMany({
          where: sameAuthor,
          orderBy: { redditCreatedAt: "desc" },
          take: AUTHOR_HISTORY_LIMIT,
          select: {
            id: true,
            title: true,
            subreddit: true,
            status: true,
            category: true,
            redditScore: true,
            numComments: true,
            redditCreatedAt: true,
          },
        }),
        ctx.db.redditPost.count({ where: sameAuthor }),
      ]);

      return { post, mentions: postMentions(post, keywords), otherPosts, otherPostCount };
    }),

  /**
   * Updates the status of a single post.
   *
   * @param input.postId - The database ID of the post.
   * @param input.status - New status: `"handled"` | `"dismissed"` | `"new"`.
   * @returns The updated post record.
   */
  updateStatus: publicProcedure
    .input(
      z.object({
        postId: z.string(),
        status: z.enum(["handled", "dismissed", "new"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const post = await ctx.db.redditPost.findUnique({ where: { id: input.postId } });
      if (!post || post.companyId !== (await activeSessionId(ctx))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post not found in this session." });
      }
      // A saved, not-relevant post must go through markRelevant, or it would
      // show up in the main feed without a reason.
      if (post.isRelevant !== true) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only relevant posts can change status. Mark the post relevant first.",
        });
      }

      return ctx.db.redditPost.update({
        where: { id: input.postId },
        data: { status: input.status },
      });
    }),

  /**
   * Moves a saved, not-relevant post into the main feed.
   * The caller's sentence is stored as the one-line reason.
   */
  markRelevant: publicProcedure
    .input(
      z.object({
        postId: z.string(),
        reason: z.string().trim().min(8).max(280),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const post = await ctx.db.redditPost.findUnique({ where: { id: input.postId } });
      if (!post || post.companyId !== (await activeSessionId(ctx))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post not found in this session." });
      }
      if (post.isRelevant === true) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This post is already relevant." });
      }
      if (post.isRelevant === null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This post has not been classified yet. Try again after the next run.",
        });
      }

      const updated = await ctx.db.redditPost.update({
        where: { id: input.postId },
        data: {
          isRelevant: true,
          status: "new",
          reason: input.reason,
        },
      });

      // Keep the tag results honest: the search that found this post now
      // has one more relevant post and one less filtered one.
      if (post.matchedQuery) {
        const search = await ctx.db.collectionSearch.findFirst({
          where: {
            companyId: post.companyId,
            query: post.matchedQuery,
            status: "done",
            filteredCount: { gt: 0 },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        if (search) {
          await ctx.db.collectionSearch.update({
            where: { id: search.id },
            data: { relevantCount: { increment: 1 }, filteredCount: { decrement: 1 } },
          });
        }
      }

      return updated;
    }),

  /**
   * Returns aggregate statistics for the dashboard.
   *
   * Includes total / relevant / filtered / urgent / pending / handled /
   * dismissed counts, plus category and sentiment breakdowns (groupBy).
   *
   * @returns Stats object with counts and breakdown arrays.
   */
  getStats: publicProcedure.query(async ({ ctx }) => {
    const companyId = (await activeSessionId(ctx)) ?? NO_SESSION;
    const [total, relevant, filtered, urgent, pending, handled, dismissed, review, rateLimited, open] =
      await Promise.all([
        ctx.db.redditPost.count({ where: { companyId } }),
        ctx.db.redditPost.count({ where: { companyId, isRelevant: true, status: { in: RELEVANT_STATUSES } } }),
        ctx.db.redditPost.count({ where: { companyId, isRelevant: false } }),
        ctx.db.redditPost.count({
          where: { companyId, isRelevant: true, urgency: { gte: 4 }, status: "new" },
        }),
        ctx.db.redditPost.count({ where: { companyId, status: "pending" } }),
        ctx.db.redditPost.count({ where: { companyId, status: "handled" } }),
        ctx.db.redditPost.count({ where: { companyId, status: "dismissed" } }),
        ctx.db.redditPost.count({ where: { companyId, status: "review" } }),
        ctx.db.redditPost.count({
          where: { companyId, status: "pending", classifyRetryAt: { gt: new Date() } },
        }),
        ctx.db.redditPost.count({ where: { companyId, isRelevant: true, status: "new" } }),
      ]);

    const shown = {
      companyId,
      isRelevant: true,
      status: { in: RELEVANT_STATUSES },
    };
    const categories = await ctx.db.redditPost.groupBy({
      by: ["category"],
      where: shown,
      _count: true,
    });

    const sentiments = await ctx.db.redditPost.groupBy({
      by: ["sentiment"],
      where: shown,
      _count: true,
    });

    return {
      total,
      relevant,
      filtered,
      urgent,
      pending,
      handled,
      dismissed,
      review,
      rateLimited,
      open,
      categories: categories.map((c) => ({
        category: c.category ?? "unknown",
        count: c._count,
      })),
      sentiments: sentiments.map((s) => ({
        sentiment: s.sentiment ?? "unknown",
        count: s._count,
      })),
    };
  }),

  /**
   * How far the active session's filter can be trusted. Read from saved posts
   * and the user's own handle / dismiss actions, so it costs no API calls.
   */
  getFilterQuality: publicProcedure.query(async ({ ctx }) => {
    const companyId = (await activeSessionId(ctx)) ?? NO_SESSION;
    const threshold = env.RELEVANCE_THRESHOLD ?? 0.7;
    const [company, posts] = await Promise.all([
      ctx.db.company.findUnique({ where: { id: companyId }, include: { keywords: true } }),
      ctx.db.redditPost.findMany({
        where: { companyId, isRelevant: { not: null }, status: { notIn: ["pending", "error"] } },
        select: { title: true, body: true, isRelevant: true, relevanceScore: true, status: true },
      }),
    ]);
    return measureFilter(company, posts, threshold);
  }),

  /**
   * Returns recent collection log entries for the activity feed.
   *
   * @param input.limit - Maximum number of log entries (default 20).
   * @returns Array of `CollectionLog` records with their parent run's status.
   */
  getRecentActivity: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).default(20) }))
    .query(async ({ ctx, input }) => {
      const companyId = (await activeSessionId(ctx)) ?? NO_SESSION;
      const logs = await ctx.db.collectionLog.findMany({
        where: { run: { companyId } },
        orderBy: { timestamp: "desc" },
        take: input.limit,
        include: { run: { select: { companyId: true, status: true } } },
      });
      return logs;
    }),
});
