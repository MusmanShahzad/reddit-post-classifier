import { postRouter } from "~/server/api/routers/post";
import { onboardingRouter } from "~/server/api/routers/onboarding";
import { collectorRouter } from "~/server/api/routers/collector";
import { settingsRouter } from "~/server/api/routers/settings";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

export const appRouter = createTRPCRouter({
  post: postRouter,
  onboarding: onboardingRouter,
  collector: collectorRouter,
  settings: settingsRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
