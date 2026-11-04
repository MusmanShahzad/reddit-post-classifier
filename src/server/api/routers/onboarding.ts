import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { checkModeration, extractOnboardingConfig } from "~/server/services/openai";
import { checkGuardrails } from "~/server/services/classifier";
import { buildSearchQueries, searchSubreddits } from "~/server/services/reddit";

export const onboardingRouter = createTRPCRouter({
  processMessage: publicProcedure
    .input(
      z.object({
        message: z.string().min(1).max(2000),
        conversationHistory: z.array(
          z.object({
            role: z.string(),
            content: z.string(),
          }),
        ),
      }),
    )
    .mutation(async ({ input }) => {
      // Layer 1: Input validation (length already handled by Zod)
      const trimmed = input.message.trim();
      if (trimmed.length < 5) {
        return {
          reply: "Could you tell me more? I need at least a company or product name to get started.",
          phase: "initial" as const,
          config: null,
        };
      }

      // Layer 2: OpenAI Moderation API (free)
      const moderation = await checkModeration(trimmed);
      if (moderation.flagged) {
        return {
          reply: "I can only help with business monitoring. Let's focus on your company or product — what would you like to track?",
          phase: "initial" as const,
          config: null,
        };
      }

      // Layer 3: Jev business check
      const guardrail = await checkGuardrails(trimmed);
      if (!guardrail.passed) {
        return {
          reply: guardrail.reason ?? "I can only help monitor businesses and products.",
          phase: "initial" as const,
          config: null,
        };
      }

      // Layer 4: GPT-4o extraction + Zod validation
      const extraction = await extractOnboardingConfig(
        input.conversationHistory,
        trimmed,
      );

      if (extraction.isConfirmation && extraction.config) {
        return {
          reply: extraction.conversationalReply,
          phase: "complete" as const,
          config: extraction.config,
        };
      }

      if (extraction.needsClarification) {
        return {
          reply: extraction.conversationalReply,
          phase: "clarifying" as const,
          config: extraction.config ?? null,
        };
      }

      return {
        reply: extraction.conversationalReply,
        phase: "confirming" as const,
        config: extraction.config ?? null,
      };
    }),

  saveConfig: publicProcedure
    .input(
      z.object({
        companyName: z.string().min(1).max(100),
        brandKeywords: z.array(
          z.object({
            value: z.string(),
            aliases: z.array(z.string()),
          }),
        ),
        competitorKeywords: z.array(z.object({ value: z.string() })),
        topicKeywords: z.array(z.object({ value: z.string() })),
        subreddits: z.array(z.string()),
        customQueries: z.array(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Create or update company
      let company = await ctx.db.company.findFirst();
      if (company) {
        company = await ctx.db.company.update({
          where: { id: company.id },
          data: { name: input.companyName },
        });
        // Clear old data
        await ctx.db.keyword.deleteMany({ where: { companyId: company.id } });
        await ctx.db.subreddit.deleteMany({ where: { companyId: company.id } });
        await ctx.db.searchQuery.deleteMany({ where: { companyId: company.id } });
      } else {
        company = await ctx.db.company.create({
          data: { name: input.companyName },
        });
      }

      // Save keywords
      const allKeywords: Array<{ type: string; value: string; aliases: string[] }> = [];

      for (const brand of input.brandKeywords) {
        await ctx.db.keyword.create({
          data: {
            companyId: company.id,
            type: "brand",
            value: brand.value,
            aliases: JSON.stringify(brand.aliases),
          },
        });
        allKeywords.push({ type: "brand", value: brand.value, aliases: brand.aliases });
      }

      for (const comp of input.competitorKeywords) {
        await ctx.db.keyword.create({
          data: {
            companyId: company.id,
            type: "competitor",
            value: comp.value,
            aliases: "[]",
          },
        });
        allKeywords.push({ type: "competitor", value: comp.value, aliases: [] });
      }

      for (const topic of input.topicKeywords) {
        await ctx.db.keyword.create({
          data: {
            companyId: company.id,
            type: "topic",
            value: topic.value,
            aliases: "[]",
          },
        });
        allKeywords.push({ type: "topic", value: topic.value, aliases: [] });
      }

      // Save subreddits
      for (const sub of input.subreddits) {
        await ctx.db.subreddit.create({
          data: { companyId: company.id, name: sub },
        });
      }

      // Generate and save search queries
      const autoQueries = buildSearchQueries(allKeywords);
      const customQueries = input.customQueries ?? [];
      const allQueries = [...autoQueries, ...customQueries];

      for (const q of allQueries) {
        await ctx.db.searchQuery.create({
          data: {
            companyId: company.id,
            query: q,
            isCustom: customQueries.includes(q),
          },
        });
      }

      // Update app settings
      await ctx.db.appSettings.upsert({
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
    }),

  suggestSubreddits: publicProcedure
    .input(z.object({ topics: z.array(z.string()) }))
    .mutation(async ({ input }) => {
      const allSuggestions = new Map<
        string,
        { name: string; subscribers: number; description: string }
      >();

      for (const topic of input.topics.slice(0, 5)) {
        try {
          const results = await searchSubreddits(topic, 8);
          for (const r of results) {
            if (!allSuggestions.has(r.name)) {
              allSuggestions.set(r.name, r);
            }
          }
        } catch {
          console.warn(`Failed to search subreddits for "${topic}"`);
        }
      }

      return [...allSuggestions.values()]
        .sort((a, b) => b.subscribers - a.subscribers)
        .slice(0, 12);
    }),

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
