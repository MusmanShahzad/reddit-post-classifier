import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { runCollection } from "~/server/services/collector";

export const collectorRouter = createTRPCRouter({
  getLastRun: publicProcedure.query(async ({ ctx }) => {
    const lastRun = await ctx.db.collectionRun.findFirst({
      orderBy: { startedAt: "desc" },
      include: {
        logs: { orderBy: { timestamp: "desc" }, take: 20 },
      },
    });
    return lastRun;
  }),

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

// SSE endpoint for streaming collection events is in /api/collect/route.ts
