import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

export const postRouter = createTRPCRouter({
  getFeed: publicProcedure
    .input(
      z.object({
        category: z.string().optional(),
        sentiment: z.string().optional(),
        minUrgency: z.number().min(1).max(5).optional(),
        status: z.enum(["new", "handled", "all"]).default("new"),
        cursor: z.string().optional(),
        limit: z.number().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {
        isRelevant: true,
        status: { not: "dismissed" },
      };

      if (input.status === "new") {
        where.status = "new";
      } else if (input.status === "handled") {
        where.status = "handled";
      } else {
        where.status = { notIn: ["dismissed", "pending", "filtered", "error"] };
      }

      if (input.category) {
        where.category = input.category;
      }
      if (input.sentiment) {
        where.sentiment = input.sentiment;
      }
      if (input.minUrgency) {
        where.urgency = { gte: input.minUrgency };
      }

      const posts = await ctx.db.redditPost.findMany({
        where,
        orderBy: [{ urgency: "desc" }, { redditCreatedAt: "desc" }],
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      });

      let nextCursor: string | undefined;
      if (posts.length > input.limit) {
        const nextItem = posts.pop();
        nextCursor = nextItem?.id;
      }

      return { posts, nextCursor };
    }),

  updateStatus: publicProcedure
    .input(
      z.object({
        postId: z.string(),
        status: z.enum(["handled", "dismissed", "new"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.redditPost.update({
        where: { id: input.postId },
        data: { status: input.status },
      });
    }),

  getStats: publicProcedure.query(async ({ ctx }) => {
    const [total, relevant, filtered, urgent, pending, handled, dismissed] =
      await Promise.all([
        ctx.db.redditPost.count(),
        ctx.db.redditPost.count({ where: { isRelevant: true } }),
        ctx.db.redditPost.count({ where: { isRelevant: false } }),
        ctx.db.redditPost.count({
          where: { isRelevant: true, urgency: { gte: 4 }, status: "new" },
        }),
        ctx.db.redditPost.count({ where: { status: "new" } }),
        ctx.db.redditPost.count({ where: { status: "handled" } }),
        ctx.db.redditPost.count({ where: { status: "dismissed" } }),
      ]);

    // Category breakdown
    const categories = await ctx.db.redditPost.groupBy({
      by: ["category"],
      where: { isRelevant: true, status: { notIn: ["dismissed", "pending", "filtered"] } },
      _count: true,
    });

    // Sentiment breakdown
    const sentiments = await ctx.db.redditPost.groupBy({
      by: ["sentiment"],
      where: { isRelevant: true, status: { notIn: ["dismissed", "pending", "filtered"] } },
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

  getRecentActivity: publicProcedure
    .input(z.object({ limit: z.number().default(20) }))
    .query(async ({ ctx, input }) => {
      const logs = await ctx.db.collectionLog.findMany({
        orderBy: { timestamp: "desc" },
        take: input.limit,
        include: { run: { select: { companyId: true, status: true } } },
      });
      return logs;
    }),
});
