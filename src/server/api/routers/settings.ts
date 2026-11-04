import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { buildSearchQueries } from "~/server/services/reddit";

export const settingsRouter = createTRPCRouter({
  getCompany: publicProcedure.query(async ({ ctx }) => {
    const settings = await ctx.db.appSettings.findUnique({
      where: { id: "default" },
    });
    if (!settings?.activeCompanyId) return null;

    return ctx.db.company.findUnique({
      where: { id: settings.activeCompanyId },
      include: {
        keywords: true,
        subreddits: true,
        searchQueries: true,
      },
    });
  }),

  updateKeyword: publicProcedure
    .input(
      z.object({
        id: z.string(),
        value: z.string().optional(),
        aliases: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const data: Record<string, unknown> = {};
      if (input.value !== undefined) data.value = input.value;
      if (input.aliases !== undefined)
        data.aliases = JSON.stringify(input.aliases);

      return ctx.db.keyword.update({ where: { id: input.id }, data });
    }),

  addKeyword: publicProcedure
    .input(
      z.object({
        companyId: z.string(),
        type: z.enum(["brand", "competitor", "topic"]),
        value: z.string().min(1),
        aliases: z.array(z.string()).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const keyword = await ctx.db.keyword.create({
        data: {
          companyId: input.companyId,
          type: input.type,
          value: input.value,
          aliases: JSON.stringify(input.aliases),
        },
      });

      // Regenerate search queries
      await regenerateSearchQueries(ctx.db, input.companyId);

      return keyword;
    }),

  deleteKeyword: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const keyword = await ctx.db.keyword.findUnique({
        where: { id: input.id },
      });
      if (!keyword) return;

      await ctx.db.keyword.delete({ where: { id: input.id } });
      await regenerateSearchQueries(ctx.db, keyword.companyId);
    }),

  addSubreddit: publicProcedure
    .input(
      z.object({
        companyId: z.string(),
        name: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.subreddit.upsert({
        where: {
          companyId_name: {
            companyId: input.companyId,
            name: input.name,
          },
        },
        create: {
          companyId: input.companyId,
          name: input.name,
        },
        update: { isActive: true },
      });
    }),

  removeSubreddit: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.subreddit.delete({ where: { id: input.id } });
    }),

  addCustomQuery: publicProcedure
    .input(
      z.object({
        companyId: z.string(),
        query: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.searchQuery.create({
        data: {
          companyId: input.companyId,
          query: input.query,
          isCustom: true,
        },
      });
    }),

  deleteSearchQuery: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.searchQuery.delete({ where: { id: input.id } });
    }),

  getSettings: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.appSettings.findUnique({ where: { id: "default" } });
  }),

  updateSettings: publicProcedure
    .input(
      z.object({
        collectionIntervalMins: z.number().min(5).max(1440).optional(),
        relevanceThreshold: z.number().min(0).max(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.appSettings.upsert({
        where: { id: "default" },
        create: { id: "default", ...input },
        update: input,
      });
    }),
});

async function regenerateSearchQueries(
  db: typeof import("~/server/db").db,
  companyId: string,
) {
  // Get all keywords
  const keywords = await db.keyword.findMany({ where: { companyId } });

  // Remove auto-generated queries
  await db.searchQuery.deleteMany({
    where: { companyId, isCustom: false },
  });

  // Generate new ones
  const keywordData = keywords.map((k) => ({
    type: k.type,
    value: k.value,
    aliases: JSON.parse(k.aliases) as string[],
  }));

  const newQueries = buildSearchQueries(keywordData);
  for (const q of newQueries) {
    await db.searchQuery.create({
      data: { companyId, query: q, isCustom: false },
    });
  }
}
