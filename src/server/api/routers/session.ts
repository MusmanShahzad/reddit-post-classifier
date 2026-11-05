/**
 * Session tRPC Router
 *
 * A session is one monitoring setup: its own brief, searches, and saved
 * posts. The app shows one session at a time and can switch between them.
 *
 * @module api/routers/session
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { RELEVANT_STATUSES } from "@/lib/feed-filter";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { activeSessionId } from "@/server/services/active-session";

/** What a session's run is doing, for the live badge beside its name. */
export type SessionRunState = "collecting" | "waiting" | "queued" | null;

export const sessionRouter = createTRPCRouter({
  /** Every session, newest first, with its post counts, unseen posts and what its run is doing. */
  list: publicProcedure.query(async ({ ctx }) => {
    const [settings, companies, relevant, toCheck, activeRuns] = await Promise.all([
      ctx.db.appSettings.findUnique({ where: { id: "default" } }),
      ctx.db.company.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          sessionName: true,
          keepWhen: true,
          lastSeenAt: true,
          autoCollect: true,
          createdAt: true,
          _count: { select: { posts: true } },
        },
      }),
      ctx.db.redditPost.groupBy({
        by: ["companyId"],
        where: { isRelevant: true, status: { in: RELEVANT_STATUSES } },
        _count: true,
      }),
      ctx.db.redditPost.groupBy({
        by: ["companyId"],
        where: { isRelevant: true, status: "review" },
        _count: true,
      }),
      ctx.db.collectionRun.findMany({
        where: { status: { in: ["running", "queued"] } },
        select: { companyId: true, status: true, waitingUntil: true },
      }),
    ]);
    const relevantBySession = new Map(relevant.map((row) => [row.companyId, row._count]));
    const toCheckBySession = new Map(toCheck.map((row) => [row.companyId, row._count]));
    // The session's own seen time differs per row, so each is counted on its own.
    const newPosts = await Promise.all(
      companies.map((company) =>
        ctx.db.redditPost.count({
          where: {
            companyId: company.id,
            isRelevant: true,
            status: { in: ["new", "review"] },
            ...(company.lastSeenAt ? { classifiedAt: { gt: company.lastSeenAt } } : {}),
          },
        }),
      ),
    );

    const runStateOf = (companyId: string): SessionRunState => {
      const runs = activeRuns.filter((run) => run.companyId === companyId);
      const running = runs.find((run) => run.status === "running");
      if (running) return running.waitingUntil ? "waiting" : "collecting";
      return runs.length > 0 ? "queued" : null;
    };

    return {
      activeId: settings?.activeCompanyId ?? null,
      sessions: companies.map((company, index) => ({
        id: company.id,
        label: company.sessionName.trim() || company.name,
        companyName: company.name,
        keepWhen: company.keepWhen,
        createdAt: company.createdAt,
        posts: company._count.posts,
        relevant: relevantBySession.get(company.id) ?? 0,
        toCheck: toCheckBySession.get(company.id) ?? 0,
        newPosts: newPosts[index] ?? 0,
        runState: runStateOf(company.id),
        autoCollect: company.autoCollect ?? company.id === settings?.activeCompanyId,
      })),
    };
  }),

  /** Clears the open session's new-post badge. Returns the earlier time, so the feed can mark what arrived since. */
  markSeen: publicProcedure.mutation(async ({ ctx }) => {
    const companyId = await activeSessionId(ctx);
    if (!companyId) return { previous: null };

    const company = await ctx.db.company.findUnique({ where: { id: companyId }, select: { lastSeenAt: true } });
    await ctx.db.company.updateMany({ where: { id: companyId }, data: { lastSeenAt: new Date() } });
    return { previous: company?.lastSeenAt ?? null };
  }),

  /** Whether the schedule collects a session, whichever session is open. */
  setAutoCollect: publicProcedure
    .input(z.object({ id: z.string().min(1), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db.company.updateMany({
        where: { id: input.id },
        data: { autoCollect: input.enabled },
      });
      if (updated.count === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
      return { id: input.id, enabled: input.enabled };
    }),

  /** Shows another session. Its runs and posts stay as they are. */
  switchTo: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const company = await ctx.db.company.findUnique({ where: { id: input.id }, select: { id: true } });
      if (!company) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });

      await ctx.db.appSettings.upsert({
        where: { id: "default" },
        create: { id: "default", activeCompanyId: company.id, isOnboardingComplete: true },
        update: { activeCompanyId: company.id, isOnboardingComplete: true },
      });
      return { activeId: company.id };
    }),

  rename: publicProcedure
    .input(z.object({ id: z.string().min(1), label: z.string().trim().min(1).max(60) }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db.company.updateMany({
        where: { id: input.id },
        data: { sessionName: input.label },
      });
      if (updated.count === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });
      return { id: input.id, label: input.label };
    }),

  /**
   * Deletes a session with its posts, searches, runs, and logs. A session
   * that is collecting right now cannot be deleted. One that is only waiting
   * can, because a wait may last until someone adds credits.
   */
  remove: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const running = await ctx.db.collectionRun.count({
        where: { companyId: input.id, status: "running", waitingUntil: null },
      });
      if (running > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This session is collecting right now. Delete it after the run finishes.",
        });
      }

      const deleted = await ctx.db.company.deleteMany({ where: { id: input.id } });
      if (deleted.count === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found." });

      const settings = await ctx.db.appSettings.findUnique({ where: { id: "default" } });
      if (settings?.activeCompanyId && settings.activeCompanyId !== input.id) {
        return { activeId: settings.activeCompanyId };
      }

      const next = await ctx.db.company.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } });
      await ctx.db.appSettings.upsert({
        where: { id: "default" },
        create: { id: "default", activeCompanyId: next?.id ?? null, isOnboardingComplete: Boolean(next) },
        update: { activeCompanyId: next?.id ?? null, isOnboardingComplete: Boolean(next) },
      });
      return { activeId: next?.id ?? null };
    }),
});
