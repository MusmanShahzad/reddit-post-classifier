"use client";

import { api } from "@/trpc/react";
import { AppLoadingSkeleton } from "@/components/atoms";
import { AppShell } from "./app-shell";
import { SessionSetup } from "./session-setup";

/** First setup when there is no session yet, otherwise the app for `sessionId`. */
export function Home({ sessionId }: { sessionId?: string }) {
  const { data: status, isLoading } = api.onboarding.getStatus.useQuery();

  if (isLoading) {
    return <AppLoadingSkeleton />;
  }

  if (!status?.isOnboardingComplete) {
    return <SessionSetup />;
  }

  return <AppShell sessionId={sessionId} />;
}
