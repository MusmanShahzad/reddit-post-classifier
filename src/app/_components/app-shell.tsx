"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Newspaper, Settings as SettingsIcon } from "lucide-react";
import { api } from "@/trpc/react";
import { readableError } from "@/lib/trpc-error";
import type { FeedRelevance } from "@/lib/feed-filter";
import { DashboardSkeleton } from "@/components/atoms";
import { SessionSwitcher } from "@/components/molecules";
import { LiveStatus } from "@/components/organisms";
import { AppLayout } from "@/components/templates";
import { Dashboard } from "./dashboard";
import { Feed } from "./feed";
import { SessionSetup } from "./session-setup";
import { Settings } from "./settings";

const iconClass = "size-4";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className={iconClass} aria-hidden /> },
  { id: "feed", label: "Feed", icon: <Newspaper className={iconClass} aria-hidden /> },
  { id: "settings", label: "Settings", icon: <SettingsIcon className={iconClass} aria-hidden /> },
];

/** Cached answers that survive a session switch. Everything else belongs to one session. */
const SHARED_ROUTERS = new Set(["session", "onboarding"]);

/**
 * The session list is the small query that notices activity, including a run
 * the schedule started. A change there refreshes the larger queries at once.
 */
const SESSIONS_BUSY_POLL_MS = 2000;
const SESSIONS_IDLE_POLL_MS = 3000;
const RUN_BUSY_POLL_MS = 1500;
const RUN_IDLE_POLL_MS = 30_000;
const DEFAULT_TITLE = "Radarr — Reddit Listening Tool";

/** Survives the remount that a new `/[sessionId]` URL causes. */
let lastTab = "dashboard";

export function AppShell({ sessionId }: { sessionId?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [tab, setTabState] = useState(lastTab);
  const [creating, setCreating] = useState(false);
  const [feedView, setFeedView] = useState<FeedRelevance>("relevant");
  const [error, setError] = useState<string | null>(null);
  const utils = api.useUtils();
  const sessionList = api.session.list.useQuery(undefined, {
    refetchInterval: (query) =>
      query.state.data?.sessions.some((session) => session.runState) ? SESSIONS_BUSY_POLL_MS : SESSIONS_IDLE_POLL_MS,
    refetchIntervalInBackground: true,
  });
  const { data } = sessionList;
  const lastRun = api.collector.getLastRun.useQuery(undefined, {
    refetchInterval: (query) =>
      query.state.data?.status === "running" || query.state.data?.status === "queued"
        ? RUN_BUSY_POLL_MS
        : RUN_IDLE_POLL_MS,
  });
  const runActive = lastRun.data?.status === "running" || lastRun.data?.status === "queued";
  const stats = api.post.getStats.useQuery(undefined, {
    enabled: runActive,
    refetchInterval: runActive ? SESSIONS_BUSY_POLL_MS : false,
  });
  const switchTo = api.session.switchTo.useMutation();
  const remove = api.session.remove.useMutation();
  const switching = useRef<string | null>(null);

  const setTab = (id: string) => {
    lastTab = id;
    setTabState(id);
  };

  const sessions = data?.sessions ?? [];
  const activeId = data?.activeId ?? null;
  const shownId = sessionId ?? activeId;
  const active = sessions.find((session) => session.id === shownId);
  const pending = Boolean(data && sessionId && sessionId !== activeId);
  const busy = switchTo.isPending || remove.isPending;
  const totalNew = sessions.reduce((total, session) => total + session.newPosts, 0);
  const activeNew = active?.newPosts ?? 0;

  // A run can start and finish between slower refreshes, so any change here updates every screen.
  const activity = active ? `${active.runState}|${active.posts}|${active.relevant}|${active.toCheck}|${active.newPosts}` : null;
  const lastActivity = useRef(activity);
  useEffect(() => {
    if (activity === lastActivity.current) return;
    lastActivity.current = activity;
    void utils.collector.getLastRun.invalidate();
    void utils.collector.getSchedule.invalidate();
    void utils.post.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity]);

  // Shows new posts in the browser tab, for someone working in another window.
  useEffect(() => {
    document.title = totalNew > 0 ? `(${totalNew}) ${DEFAULT_TITLE}` : DEFAULT_TITLE;
  }, [totalNew]);

  /** Drops every cached answer from the previous session so no old number is ever shown. */
  const forgetSessionData = () =>
    queryClient.removeQueries({
      predicate: (query) => {
        const path = query.queryKey[0];
        return !(Array.isArray(path) && SHARED_ROUTERS.has(String(path[0])));
      },
    });

  // The URL decides which session is shown.
  useEffect(() => {
    if (!data) return;

    if (!sessionId) {
      if (activeId) router.replace(`/${activeId}`);
      return;
    }
    if (sessionId === activeId || switching.current === sessionId) return;

    if (!sessions.some((session) => session.id === sessionId)) {
      setError("That session no longer exists. Showing the current one.");
      router.replace(activeId ? `/${activeId}` : "/");
      return;
    }

    switching.current = sessionId;
    setError(null);
    switchTo
      .mutateAsync({ id: sessionId })
      .then(async () => {
        forgetSessionData();
        await utils.session.list.invalidate();
      })
      .catch((cause: unknown) => {
        setError(readableError(cause instanceof Error ? cause : null) ?? "Could not switch session.");
        router.replace(activeId ? `/${activeId}` : "/");
      })
      .finally(() => {
        switching.current = null;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sessionId, activeId]);

  const select = (id: string) => {
    setError(null);
    setCreating(false);
    if (id === shownId) return;
    setFeedView("relevant");
    router.push(`/${id}`);
  };

  const destroy = async (id: string) => {
    setError(null);
    try {
      const result = await remove.mutateAsync({ id });
      if (id === shownId) forgetSessionData();
      await utils.invalidate();
      if (id === shownId) router.replace(result.activeId ? `/${result.activeId}` : "/");
    } catch (cause) {
      setError(readableError(cause instanceof Error ? cause : null) ?? "Could not delete session.");
    }
  };

  const created = async () => {
    setCreating(false);
    setTab("dashboard");
    const fresh = await utils.session.list.fetch();
    if (fresh.activeId) router.push(`/${fresh.activeId}`);
  };

  return (
    <AppLayout
      tabs={TABS.map((item) => (item.id === "feed" && tab !== "feed" ? { ...item, badge: activeNew } : item))}
      activeTab={creating ? "new-session" : tab}
      onTabChange={(id) => {
        setCreating(false);
        setFeedView("relevant");
        setTab(id);
      }}
      title={creating ? "New session" : active?.label}
      sidebar={
        <SessionSwitcher
          sessions={sessions}
          activeId={shownId}
          creating={creating}
          busy={busy}
          onSelect={select}
          onCreate={() => {
            setError(null);
            setCreating(true);
          }}
          onDelete={(id) => void destroy(id)}
        />
      }
    >
      {error && (
        <div role="alert" className="alert alert-error alert-soft mb-4">
          <span>{error}</span>
        </div>
      )}

      {creating ? (
        <SessionSetup embedded onCancel={() => setCreating(false)} onDone={() => void created()} />
      ) : (
        <>
          {active && (
            <div className="mb-4 hidden lg:block">
              <h1 className="text-xl font-bold">{active.label}</h1>
              {active.keepWhen && (
                <p className="text-sm text-base-content/70">Looking for: {active.keepWhen}</p>
              )}
            </div>
          )}
          {!pending && (
            <LiveStatus
              run={lastRun.data}
              pending={stats.data?.pending}
              rateLimited={stats.data?.rateLimited}
              disconnected={sessionList.isRefetchError}
            />
          )}
          {pending || !data ? (
            <DashboardSkeleton />
          ) : (
            <div key={activeId ?? "none"} className="animate-rise-in">
              {tab === "dashboard" && (
                <Dashboard
                  onOpenReview={() => {
                    setFeedView("review");
                    setTab("feed");
                  }}
                />
              )}
              {tab === "feed" && <Feed key={feedView} initialRelevance={feedView} />}
              {tab === "settings" && <Settings />}
            </div>
          )}
        </>
      )}
    </AppLayout>
  );
}
