/**
 * Settings tRPC Router
 *
 * Full CRUD for managing the monitoring configuration after onboarding:
 * keywords, subreddits, search queries, and app-level settings.
 *
 * Auto-generated search queries are regenerated whenever keywords change.
 * Custom queries are preserved across regeneration.
 *
 * Procedures:
 * - {@link getCompany} — Current company with all related data.
 * - {@link updateBrief} — Who buys it and what to skip, for the active session.
 * - {@link updateKeyword} / {@link addKeyword} / {@link deleteKeyword} — Keyword CRUD.
 * - {@link addSubreddit} / {@link removeSubreddit} — Subreddit management.
 * - {@link addCustomQuery} / {@link deleteSearchQuery} — Custom query management.
 * - {@link getSettings} / {@link updateSettings} — App-level config.
 *
 * @module api/routers/settings
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { foldSearchRows, rowsFromTaggedPosts, tallyForKeyword } from "@/lib/search-stats";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { activeSessionId } from "@/server/services/active-session";
import { parseGoals } from "@/lib/goals";
import { aliasList } from "@/lib/post-tags";
import { buildSearchQueries } from "@/server/services/reddit";

const keywordValue = z.string().trim().min(1).max(80);
const keywordAliases = z.array(keywordValue).max(20);
const subredditName = z
  .string()
  .trim()
  .transform((name) => name.replace(/^\/?r\//i, ""))
  .pipe(z.string().regex(/^[A-Za-z0-9_]{2,21}$/, "Use a subreddit name like webdev"));

export const settingsRouter = createTRPCRouter({
  /**
   * Returns the active company with all keywords, subreddits, and search queries.
   *
   * @returns Company record with relations, or `null` if no company is configured.
   */
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

  /**
   * Saves the optional brief answers for the active session: who buys it,
   * and what to skip. Posts classified after this use the new answers.
   */
  updateBrief: publicProcedure
    .input(
      z.object({
        buyer: z.string().trim().max(300),
        notAbout: z.string().trim().max(400),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const companyId = await activeSessionId(ctx.db);
      if (!companyId) throw new TRPCError({ code: "NOT_FOUND", message: "No active session." });
      return ctx.db.company.update({
        where: { id: companyId },
        data: { buyer: input.buyer, notAbout: input.notAbout },
      });
    }),

  /**
   * Updates an existing keyword's value or aliases.
   *
   * @param input.id      - Keyword database ID.
   * @param input.value   - New keyword value (optional).
   * @param input.aliases - New aliases array (optional; stored as JSON string).
   * @returns Updated keyword record.
   */
  updateKeyword: publicProcedure
    .input(
      z.object({
        id: z.string(),
        value: keywordValue.optional(),
        aliases: keywordAliases.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.keyword.findUnique({ where: { id: input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Keyword not found" });

      const data: { value?: string; aliases?: string } = {};
      if (input.value !== undefined) data.value = input.value;
      if (input.aliases !== undefined) data.aliases = JSON.stringify(input.aliases);

      const keyword = await ctx.db.keyword.update({ where: { id: input.id }, data });
      // Search queries are built from keywords, so they change with them.
      await regenerateSearchQueries(ctx.db, existing.companyId);
      return keyword;
    }),

  /**
   * Adds a new keyword and regenerates auto-generated search queries.
   *
   * @param input.companyId - Company to add the keyword to.
   * @param input.type      - `"brand"` | `"competitor"` | `"topic"`.
   * @param input.value     - Keyword text (min 1 char).
   * @param input.aliases   - Optional aliases array (default `[]`).
   * @returns Created keyword record.
   */
  addKeyword: publicProcedure
    .input(
      z.object({
        companyId: z.string(),
        type: z.enum(["brand", "competitor", "topic"]),
        value: keywordValue,
        aliases: keywordAliases.default([]),
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

      await regenerateSearchQueries(ctx.db, input.companyId);

      return keyword;
    }),

  /**
   * Deletes a keyword and regenerates auto-generated search queries.
   *
   * @param input.id - Keyword database ID.
   */
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

  /**
   * Adds a subreddit to the monitored list (upserts to handle re-activation).
   *
   * @param input.companyId - Company to add the subreddit to.
   * @param input.name      - Subreddit name without `r/` prefix.
   * @returns Created or reactivated subreddit record.
   */
  addSubreddit: publicProcedure
    .input(
      z.object({
        companyId: z.string(),
        name: subredditName,
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

  /**
   * Removes a subreddit from monitoring.
   *
   * @param input.id - Subreddit database ID.
   * @returns Deleted subreddit record.
   */
  removeSubreddit: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // deleteMany so a double click on an already removed tag does not error.
      return ctx.db.subreddit.deleteMany({ where: { id: input.id } });
    }),

  /**
   * Adds a custom search query (preserved across keyword regeneration).
   *
   * @param input.companyId - Company to add the query to.
   * @param input.query     - The search query string.
   * @returns Created search query record.
   */
  addCustomQuery: publicProcedure
    .input(
      z.object({
        companyId: z.string(),
        query: z
          .string()
          .trim()
          .min(1)
          .max(250)
          .refine((query) => new TextEncoder().encode(query).length <= 256, "Query is too long"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.searchQuery.findFirst({
        where: { companyId: input.companyId, query: input.query },
      });
      if (existing) return existing;

      return ctx.db.searchQuery.create({
        data: {
          companyId: input.companyId,
          query: input.query,
          isCustom: true,
        },
      });
    }),

  /**
   * Deletes a custom search query. Automatic queries come from keywords, so edit the keyword instead.
   *
   * @param input.id - Search query database ID.
   * @returns Deleted search query record.
   */
  deleteSearchQuery: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.searchQuery.deleteMany({ where: { id: input.id, isCustom: true } });
    }),

  /**
   * Returns global app settings.
   *
   * @returns `AppSettings` record or `null` if not yet created.
   */
  getSettings: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.appSettings.findUnique({ where: { id: "default" } });
  }),

  /**
   * Updates global app settings (collection interval, relevance threshold).
   *
   * @param input.collectionIntervalMins - Minutes between auto-collections (5–1440).
   * @param input.relevanceThreshold     - Minimum Jev noul score for relevance (0–1).
   * @param input.autoCollectEnabled     - Master switch for every scheduled run.
   * @param input.authorLookupsEnabled   - Whether paid author profile lookups are sent.
   * @param input.authorLookupsPerRun    - The most paid profile lookups in one run (1–200).
   * @returns Updated `AppSettings` record.
   */
  updateSettings: publicProcedure
    .input(
      z.object({
        collectionIntervalMins: z.number().int().min(5).max(1440).optional(),
        relevanceThreshold: z.number().min(0).max(1).optional(),
        autoCollectEnabled: z.boolean().optional(),
        authorLookupsEnabled: z.boolean().optional(),
        authorLookupsPerRun: z.number().int().min(1).max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.appSettings.upsert({
        where: { id: "default" },
        create: { id: "default", ...input },
        update: input,
      });
    }),

  /**
   * Totals for every search and keyword, so weak tags can be edited.
   */
  getTagPerformance: publicProcedure.query(async ({ ctx }) => {
    const settings = await ctx.db.appSettings.findUnique({ where: { id: "default" } });
    if (!settings?.activeCompanyId) return { keywords: [], queries: [] };

    const companyId = settings.activeCompanyId;
    const [keywords, searches, taggedPosts] = await Promise.all([
      ctx.db.keyword.findMany({ where: { companyId } }),
      ctx.db.collectionSearch.findMany({
        where: { companyId },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
      ctx.db.redditPost.findMany({
        where: { companyId, matchedQuery: { not: null } },
        select: { matchedQuery: true, isRelevant: true },
      }),
    ]);

    // Posts saved by a run that never wrote search rows still count for their tag.
    const covered = new Set(searches.map((search) => search.query));
    const fromPosts = rowsFromTaggedPosts(taggedPosts).filter((row) => !covered.has(row.query));
    const queries = foldSearchRows([...searches, ...fromPosts]);
    return {
      queries,
      keywords: keywords.map((keyword) => {
        const aliases = aliasList(keyword.aliases);
        const tally = tallyForKeyword(keyword.value, aliases, queries);
        return {
          id: keyword.id,
          type: keyword.type,
          value: keyword.value,
          verdict: tally.verdict,
          fetched: tally.fetched,
          fresh: tally.fresh,
          duplicates: tally.duplicates,
          relevant: tally.relevant,
          filtered: tally.filtered,
          done: tally.done,
          failed: tally.failed,
          skipped: tally.skipped,
        };
      }),
    };
  }),
});

/**
 * Regenerates auto-generated search queries for a company.
 *
 * Deletes all non-custom queries, rebuilds from current keywords using
 * {@link buildSearchQueries}, and persists the new set.
 *
 * @param db        - Prisma client instance.
 * @param companyId - Company whose queries to regenerate.
 */
async function regenerateSearchQueries(
  db: typeof import("@/server/db").db,
  companyId: string,
) {
  const [keywords, company] = await Promise.all([
    db.keyword.findMany({ where: { companyId } }),
    db.company.findUnique({ where: { id: companyId }, select: { goals: true } }),
  ]);

  const keywordData = keywords.map((k) => ({
    type: k.type,
    value: k.value,
    aliases: aliasList(k.aliases),
    ambiguous: k.ambiguous,
  }));

  const newQueries = buildSearchQueries(keywordData, parseGoals(company?.goals));

  // One transaction, so a collection that starts mid-edit never sees an empty list.
  await db.$transaction([
    db.searchQuery.deleteMany({ where: { companyId, isCustom: false } }),
    db.searchQuery.createMany({
      data: newQueries.map((query) => ({ companyId, query, isCustom: false })),
    }),
  ]);
}
