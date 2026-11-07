/**
 * Collector tRPC Router
 *
 * Provides read-only access to collection run history and status.
 * The collection pipeline is started in the background by the scheduler
 * and by `POST /api/collect`.
 *
 * Procedures:
 * - {@link getLastRun} — The active session's run to show: the running one, else the newest with results.
 * - {@link getSchedule} — Interval, next run time, cost estimate, and whether one run is queued.
 * - {@link getRunStatus} — Status and logs for a specific run by ID.
 *
 * @module api/routers/collector
 */

import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "@/server/api/trpc";
import { clampInterval, nextDueAt } from "@/lib/schedule";
import { activeSessionId } from "@/server/services/active-session";
import { reconcileStaleRuns } from "@/server/services/collection-runs";
import { CREDITS_PER_LOOKUP, CREDITS_PER_SEARCH, queriesForCollection } from "@/server/services/reddit/queries";
import { startScheduler } from "@/server/services/scheduler";
import { findDisplayRun } from "@/server/services/search-queue";

export const collectorRouter = createTRPCRouter({
  /**
   * Returns the run the dashboard should show with up to 100 log entries,
   * newest first. A running run always wins over a waiting one. Runs cut
   * off by a server stop are settled before reading.
   *
   * @returns `CollectionRun` with `logs` and `searches`, or `null` if none exist.
   */
  getLastRun: publicProcedure.query(async ({ ctx }) => {
    await reconcileStaleRuns(ctx.db);
    const companyId = await activeSessionId(ctx);
    return companyId ? findDisplayRun(ctx.db, companyId) : null;
  }),

  /**
   * Returns the automatic collection schedule for the active company,
   * including what one run costs in search credits.
   */
  getSchedule: publicProcedure.query(async ({ ctx }) => {
    startScheduler();
    const settings = await ctx.db.appSettings.findUnique({ where: { id: "default" } });
    const companyId = await activeSessionId(ctx);
    const intervalMins = clampInterval(settings?.collectionIntervalMins);

    const [last, queuedRun, queryRows, company] = await Promise.all([
      companyId
        ? ctx.db.collectionRun.findFirst({
            where: { companyId, status: { not: "queued" } },
            orderBy: { startedAt: "desc" },
          })
        : null,
      companyId
        ? ctx.db.collectionRun.findFirst({ where: { companyId, status: "queued" } })
        : null,
      companyId
        ? ctx.db.searchQuery.findMany({ where: { companyId, isActive: true } })
        : [],
      companyId
        ? ctx.db.company.findUnique({ where: { id: companyId }, select: { autoCollect: true } })
        : null,
    ]);

    const autoCollectEnabled = settings?.autoCollectEnabled !== false;
    // The same rule the scheduler uses: an older session with no answer collects only while it is open.
    const inSchedule = company?.autoCollect ?? companyId === settings?.activeCompanyId;
    const searchesPerRun = queriesForCollection(queryRows).selected.length;
    const creditsPerRun = searchesPerRun * CREDITS_PER_SEARCH;
    const runsPerDay = 1440 / intervalMins;

    return {
      intervalMins,
      autoCollectEnabled,
      /** Whether the scheduler will run this session by itself. */
      scheduled: autoCollectEnabled && inSchedule && queryRows.length > 0,
      enabled: Boolean(settings?.isOnboardingComplete && companyId),
      queued: Boolean(queuedRun),
      nextRunAt: nextDueAt(last, intervalMins),
      searchesPerRun,
      creditsPerRun,
      creditsPerDay: Math.round(creditsPerRun * runsPerDay),
      creditsPerLookup: CREDITS_PER_LOOKUP,
    };
  }),

  /**
   * Returns the status and logs for a specific collection run.
   *
   * @param input.runId - The database ID of the collection run.
   * @returns `CollectionRun` with up to 50 log entries, or `null` if not found.
   */
  getRunStatus: publicProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.collectionRun.findUnique({
        where: { id: input.runId },
        include: {
          logs: { orderBy: { timestamp: "desc" }, take: 50 },
        },
      });
    }),
});
