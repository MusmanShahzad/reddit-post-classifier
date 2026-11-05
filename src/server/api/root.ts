import { postRouter } from "@/server/api/routers/post";
import { onboardingRouter } from "@/server/api/routers/onboarding";
import { collectorRouter } from "@/server/api/routers/collector";
import { sessionRouter } from "@/server/api/routers/session";
import { settingsRouter } from "@/server/api/routers/settings";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";

export const appRouter = createTRPCRouter({
  post: postRouter,
  onboarding: onboardingRouter,
  collector: collectorRouter,
  settings: settingsRouter,
  session: sessionRouter,
});

export type AppRouter = typeof appRouter;

export const createCaller = createCallerFactory(appRouter);
