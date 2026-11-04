"use client";

import { api } from "~/trpc/react";
import { OnboardingChat } from "~/app/_components/onboarding-chat";
import { AppShell } from "~/app/_components/app-shell";

export default function Home() {
  const { data: status, isLoading } = api.onboarding.getStatus.useQuery();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-red-500 border-t-transparent" />
          <p className="text-sm text-gray-500">Loading Radarr...</p>
        </div>
      </div>
    );
  }

  if (!status?.isOnboardingComplete) {
    return <OnboardingChat />;
  }

  return <AppShell />;
}
