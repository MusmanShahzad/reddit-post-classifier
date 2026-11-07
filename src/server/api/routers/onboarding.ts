/**
 * Onboarding tRPC Router
 *
 * Handles the conversational onboarding flow where users describe their
 * business and the system extracts a monitoring configuration.
 *
 * Procedures:
 * - {@link processMessage} — 4-layer guardrail pipeline → extraction → reply.
 * - {@link saveConfig} — Persists extracted config (company, keywords, subreddits, queries).
 * - {@link suggestSubreddits} — Searches Reddit for relevant subreddits by topic.
 * - {@link getStatus} — Returns current onboarding completion status.
 *
 * @module api/routers/onboarding
 */

import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { keepBuyerCommunities, readGoals } from "@/server/services/classifier";
import { enqueueCollection } from "@/server/services/collection-runs";
import { answerTurn, logTurn, TurnInputSchema } from "@/server/services/onboarding-turn";
import { buildSearchQueries, searchSubreddits, subredditQueries } from "@/server/services/reddit";

export const onboardingRouter = createTRPCRouter({
  /**
   * Runs one chat turn and returns the whole reply at once. The chat uses
   * `/api/onboarding/turn`, which streams the same turn step by step.
   *
   * @returns `{ reply, phase, config, pipelineSteps }`.
   */
  processMessage: publicProcedure
    .input(TurnInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await answerTurn(input);
      await logTurn(ctx.db, input, result);
      return result;
    }),

  /**
   * Saves the confirmed onboarding configuration as a new session.
   *
   * Creates the `Company` record, populates `Keyword`, `Subreddit`, and
   * `SearchQuery` tables, attaches the logged chat, and makes it the active session.
   */
  saveConfig: publicProcedure
    .input(
      z.object({
        companyName: z.string().min(1).max(100),
        sessionName: z.string().trim().max(60).optional(),
        draftId: z.string().min(8).max(64).optional(),
        product: z.string().trim().min(1).max(300),
        buyer: z.string().trim().max(300).default(""),
        keepWhen: z.string().trim().min(1).max(400),
        notAbout: z.string().trim().max(400).default(""),
        brandKeywords: z.array(
          z.object({
            value: z.string(),
            aliases: z.array(z.string()),
            ambiguous: z.boolean().optional(),
          }),
        ),
        competitorKeywords: z.array(
          z.object({
            value: z.string(),
            aliases: z.array(z.string()).optional(),
            ambiguous: z.boolean().optional(),
          }),
        ),
        topicKeywords: z.array(z.object({ value: z.string() })),
        subreddits: z.array(z.string()),
        customQueries: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Read before the save, so a slow paid call never holds the database open.
      const goals = await readGoals({
        companyName: input.companyName,
        product: input.product,
        keepWhen: input.keepWhen,
      });

      // All or nothing, so a failed save never leaves an empty session behind.
      const saved = await ctx.db.$transaction(async (tx) => {
        const company = await tx.company.create({
          data: {
            name: input.companyName,
            sessionName: input.sessionName?.trim() || input.companyName,
            product: input.product,
            buyer: input.buyer,
            keepWhen: input.keepWhen,
            notAbout: input.notAbout,
            goals: JSON.stringify(goals),
            autoCollect: true,
          },
        });

        const allKeywords: Array<{ type: string; value: string; aliases: string[]; ambiguous?: boolean }> = [
          ...input.brandKeywords.map((keyword) => ({ ...keyword, type: "brand" })),
          ...input.competitorKeywords.map((keyword) => ({
            ...keyword,
            type: "competitor",
            aliases: keyword.aliases ?? [],
          })),
          ...input.topicKeywords.map((keyword) => ({ ...keyword, type: "topic", aliases: [] })),
        ];

        for (const keyword of allKeywords) {
          await tx.keyword.create({
            data: {
              companyId: company.id,
              type: keyword.type,
              value: keyword.value,
              aliases: JSON.stringify(keyword.aliases),
              ambiguous: keyword.ambiguous ?? false,
            },
          });
        }

        for (const sub of input.subreddits) {
          await tx.subreddit.create({
            data: { companyId: company.id, name: sub },
          });
        }

        const autoQueries = buildSearchQueries(allKeywords, goals);
        const customQueries = input.customQueries ?? [];
        const allQueries = [...new Set([...autoQueries, ...customQueries])];

        for (const q of allQueries) {
          await tx.searchQuery.create({
            data: {
              companyId: company.id,
              query: q,
              isCustom: customQueries.includes(q),
            },
          });
        }

        if (input.draftId) {
          await tx.chatMessage.updateMany({
            where: { draftId: input.draftId },
            data: { companyId: company.id },
          });
        }
        await tx.chatMessage.create({
          data: {
            companyId: company.id,
            draftId: input.draftId ?? null,
            role: "system",
            content: "Session saved",
            phase: "saved",
            metadata: JSON.stringify({ config: input, searchQueries: allQueries }),
          },
        });

        await tx.appSettings.upsert({
          where: { id: "default" },
          create: {
            id: "default",
            isOnboardingComplete: true,
            activeCompanyId: company.id,
          },
          update: {
            isOnboardingComplete: true,
            activeCompanyId: company.id,
          },
        });

        return { companyId: company.id, queriesGenerated: allQueries.length };
      });

      // Starting a session asks for its first run, so it always starts now.
      // The session is already saved, so if this fails the schedule picks it up.
      await enqueueCollection(ctx.db, saved.companyId).catch((error: unknown) => {
        console.warn(`[setup] first search did not start: ${error instanceof Error ? error.message : "Unknown"}`);
      });
      return saved;
    }),

  /**
   * Suggests relevant subreddits for the given topics.
   */
  suggestSubreddits: publicProcedure
    .input(
      z.object({
        topics: z.array(z.string()),
        product: z.string().max(300).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const allSuggestions = new Map<
        string,
        { name: string; subscribers: number; description: string }
      >();

      // Each search is paid for, so a fallback runs only when nothing has been found.
      for (const query of subredditQueries(input.topics)) {
        if (allSuggestions.size > 0) break;
        try {
          const results = await searchSubreddits(query, 12);
          console.info(`[subreddits] "${query}" found ${results.length}`);
          for (const result of results) {
            if (!allSuggestions.has(result.name)) {
              allSuggestions.set(result.name, result);
            }
          }
        } catch {
          console.warn(`Failed to search subreddits for "${query}"`);
        }
      }

      const candidates = [...allSuggestions.values()]
        .sort((a, b) => b.subscribers - a.subscribers)
        .slice(0, 12);

      // A shared word is not enough. Drop the communities that clearly do not fit.
      const kept = input.product?.trim()
        ? await keepBuyerCommunities(candidates, { product: input.product })
        : candidates;
      console.info(`[subreddits] kept ${kept.length} of ${candidates.length}`);
      return kept;
    }),

  /**
   * Returns the current onboarding completion status.
   */
  getStatus: publicProcedure.query(async ({ ctx }) => {
    const settings = await ctx.db.appSettings.findUnique({
      where: { id: "default" },
    });
    return {
      isOnboardingComplete: settings?.isOnboardingComplete ?? false,
      activeCompanyId: settings?.activeCompanyId ?? null,
    };
  }),
});

