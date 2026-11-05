"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Ban,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Clock3,
  Flame,
  Layers,
} from "lucide-react";
import { sessionHeaders } from "@/lib/session-header";
import { api } from "@/trpc/react";
import { StatCard, DashboardSkeleton } from "@/components/atoms";
import {
  CategoryBreakdown,
  CollectionStatusPanel,
  ActivityLog,
  FilterQualityCard,
  SearchQueueTable,
} from "@/components/organisms";
import { BriefEditor } from "./brief-editor";

const RUN_POLL_MS = 1500;
const STATS_POLL_MS = 2000;

export function Dashboard({ onOpenReview }: { onOpenReview?: () => void }) {
  const utils = api.useUtils();
  const { data: lastRun, isLoading: runLoading } = api.collector.getLastRun.useQuery(undefined, {
    // A queued run is about to continue, so keep watching it too.
    refetchInterval: (query) =>
      query.state.data?.status === "running" || query.state.data?.status === "queued" ? RUN_POLL_MS : false,
  });
  const isCollecting = lastRun?.status === "running";

  const { data: stats, isLoading: statsLoading } = api.post.getStats.useQuery(undefined, {
    refetchInterval: isCollecting ? STATS_POLL_MS : false,
  });
  const { data: activity, isLoading: activityLoading } = api.post.getRecentActivity.useQuery(
    { limit: 200 },
    { refetchInterval: isCollecting ? STATS_POLL_MS : false },
  );
  const { data: quality } = api.post.getFilterQuality.useQuery(undefined, {
    refetchInterval: isCollecting ? STATS_POLL_MS : false,
  });
  const { data: schedule } = api.collector.getSchedule.useQuery(undefined, {
    refetchInterval: isCollecting ? RUN_POLL_MS : 15000,
  });

  const [isStarting, setIsStarting] = useState(false);
  const [editingBrief, setEditingBrief] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [queuedNotice, setQueuedNotice] = useState<string | null>(null);

  const previousStatus = useRef(lastRun?.status);
  useEffect(() => {
    if (previousStatus.current === "running" && lastRun?.status !== "running") {
      void utils.post.invalidate();
    }
    previousStatus.current = lastRun?.status;
  }, [lastRun?.status, utils]);

  const startCollection = useCallback(async () => {
    setIsStarting(true);
    setStartError(null);
    try {
      const response = await fetch("/api/collect", { method: "POST", headers: sessionHeaders(window.location.pathname) });
      const body = (await response.json().catch(() => null)) as { error?: string; queued?: boolean } | null;
      if (!response.ok) {
        setStartError(body?.error ?? "Collection did not start");
        return;
      }
      setQueuedNotice(
        body?.queued
          ? "This run is queued. It starts when the current collection finishes."
          : null,
      );
    } catch (error) {
      setStartError(`Connection error: ${error instanceof Error ? error.message : "Unknown"}`);
    } finally {
      await utils.collector.invalidate();
      setIsStarting(false);
    }
  }, [utils]);

  if (statsLoading || runLoading || activityLoading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-6 py-4">
      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Total Posts" value={stats?.total ?? 0} icon={<Layers className="size-4" aria-hidden />} />
        <StatCard label="Relevant" value={stats?.relevant ?? 0} icon={<CircleCheck className="size-4" aria-hidden />} />
        <StatCard label="To check" value={stats?.review ?? 0} icon={<CircleHelp className="size-4" aria-hidden />} />
        <StatCard label="Filtered" value={stats?.filtered ?? 0} icon={<Ban className="size-4" aria-hidden />} />
        <StatCard label="Urgent (4+)" value={stats?.urgent ?? 0} icon={<Flame className="size-4" aria-hidden />} />
        <StatCard label="Unclassified" value={stats?.pending ?? 0} icon={<Clock3 className="size-4" aria-hidden />} />
        <StatCard label="Handled" value={stats?.handled ?? 0} icon={<CheckCheck className="size-4" aria-hidden />} />
      </div>

      {startError && (
        <div role="alert" className="alert alert-error alert-soft animate-rise-in">
          <CircleAlert className="size-4" aria-hidden />
          <span>{startError}</span>
        </div>
      )}

      {queuedNotice && (
        <div role="status" className="alert alert-soft animate-rise-in">
          <Clock3 className="size-4" aria-hidden />
          <span>{queuedNotice}</span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <CategoryBreakdown
          categories={stats?.categories ?? []}
          totalRelevant={stats?.relevant ?? 0}
        />
        <CollectionStatusPanel
          lastRun={lastRun ? {
            status: lastRun.status,
            startedAt: lastRun.startedAt,
            totalFetched: lastRun.totalFetched,
            totalNew: lastRun.totalNew,
            totalRelevant: lastRun.totalRelevant,
            waitingUntil: lastRun.waitingUntil,
          } : null}
          isCollecting={isCollecting || isStarting}
          onRunCollection={() => void startCollection()}
          schedule={schedule ?? null}
        />
      </div>

      <FilterQualityCard
        quality={quality ?? null}
        reviewCount={stats?.review ?? 0}
        onOpenReview={onOpenReview}
        onCompleteBrief={() => setEditingBrief(true)}
      />
      {editingBrief && <BriefEditor onClose={() => setEditingBrief(false)} />}

      <SearchQueueTable
        title="Search queue"
        empty="Each search shows up here with how many posts it fetched."
        rows={(lastRun?.searches ?? []).map((search) => ({
          id: search.id,
          query: search.query,
          status: search.status,
          fetchedCount: search.fetchedCount,
          newCount: search.newCount,
          duplicateCount: search.duplicateCount,
          relevantCount: search.relevantCount,
          filteredCount: search.filteredCount,
          error: search.error,
        }))}
      />

      <ActivityLog
        isCollecting={isCollecting}
        liveEvents={(lastRun?.logs ?? []).map((log) => ({
          id: log.id,
          type: log.type,
          message: log.message,
          timestamp: log.timestamp,
          runId: lastRun?.id,
          runStatus: lastRun?.status,
        }))}
        activity={(activity ?? []).map((log) => ({
          id: log.id,
          type: log.type,
          message: log.message,
          timestamp: log.timestamp,
          runId: log.runId,
          runStatus: log.run.status,
        }))}
      />
    </div>
  );
}
