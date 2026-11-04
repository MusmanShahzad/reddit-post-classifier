"use client";

import { useState, useCallback } from "react";
import { api } from "~/trpc/react";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { ScrollArea } from "~/components/ui/scroll-area";
import { CATEGORY_LABELS, CATEGORY_EMOJI, type Category } from "~/lib/types";

interface CollectionEvent {
  type: string;
  message: string;
  stats?: {
    totalFetched: number;
    totalNew: number;
    totalClassified: number;
    totalRelevant: number;
    totalFiltered: number;
    errorCount: number;
  };
}

export function Dashboard() {
  const { data: stats, refetch: refetchStats } = api.post.getStats.useQuery();
  const { data: lastRun } = api.collector.getLastRun.useQuery();
  const { data: activity } = api.post.getRecentActivity.useQuery({ limit: 15 });

  const [isCollecting, setIsCollecting] = useState(false);
  const [liveEvents, setLiveEvents] = useState<CollectionEvent[]>([]);

  const startCollection = useCallback(async () => {
    setIsCollecting(true);
    setLiveEvents([]);

    try {
      const response = await fetch("/api/collect", { method: "POST" });
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) return;

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6)) as CollectionEvent;
              setLiveEvents((prev) => [...prev, event]);
            } catch {
              // Skip malformed lines
            }
          }
        }
      }
    } catch (error) {
      setLiveEvents((prev) => [
        ...prev,
        {
          type: "error",
          message: `Connection error: ${error instanceof Error ? error.message : "Unknown"}`,
        },
      ]);
    } finally {
      setIsCollecting(false);
      void refetchStats();
    }
  }, [refetchStats]);

  const totalRelevant = stats?.relevant ?? 0;

  return (
    <div className="space-y-6 py-4">
      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total Posts" value={stats?.total ?? 0} icon="📊" />
        <StatCard label="Relevant" value={stats?.relevant ?? 0} icon="✅" color="text-green-600" />
        <StatCard label="Filtered" value={stats?.filtered ?? 0} icon="🚫" color="text-gray-400" />
        <StatCard label="Urgent (4+)" value={stats?.urgent ?? 0} icon="🔴" color="text-red-600" />
        <StatCard label="Pending" value={stats?.pending ?? 0} icon="📝" color="text-blue-600" />
        <StatCard label="Handled" value={stats?.handled ?? 0} icon="✓" color="text-green-500" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Category breakdown */}
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-gray-900">
            Category Breakdown
          </h3>
          <div className="space-y-3">
            {stats?.categories.map((c) => (
              <div key={c.category} className="flex items-center gap-3">
                <span className="w-6 text-center">
                  {CATEGORY_EMOJI[c.category as Category] ?? "📝"}
                </span>
                <span className="w-28 text-sm font-medium text-gray-700">
                  {CATEGORY_LABELS[c.category as Category] ?? c.category}
                </span>
                <div className="flex-1">
                  <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-red-400 transition-all"
                      style={{
                        width: `${totalRelevant > 0 ? (c.count / totalRelevant) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
                <span className="w-12 text-right text-sm text-gray-500">
                  {c.count}
                </span>
              </div>
            ))}
            {(!stats?.categories || stats.categories.length === 0) && (
              <p className="text-sm text-gray-400">
                No data yet. Run a collection first.
              </p>
            )}
          </div>
        </Card>

        {/* Collection status & controls */}
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">
              Collection Status
            </h3>
            {lastRun && (
              <Badge variant={lastRun.status === "completed" ? "default" : "destructive"}>
                {lastRun.status}
              </Badge>
            )}
          </div>

          {lastRun && (
            <div className="mb-4 grid grid-cols-2 gap-2 text-sm">
              <div className="text-gray-500">Last run:</div>
              <div className="font-medium">
                {new Date(lastRun.startedAt).toLocaleString()}
              </div>
              <div className="text-gray-500">Posts found:</div>
              <div className="font-medium">{lastRun.totalFetched}</div>
              <div className="text-gray-500">New posts:</div>
              <div className="font-medium">{lastRun.totalNew}</div>
              <div className="text-gray-500">Relevant:</div>
              <div className="font-medium text-green-600">
                {lastRun.totalRelevant}
              </div>
            </div>
          )}

          <Button
            onClick={() => void startCollection()}
            disabled={isCollecting}
            className="w-full bg-red-500 hover:bg-red-600"
          >
            {isCollecting ? "⏳ Collecting..." : "🔄 Run Collection Now"}
          </Button>
        </Card>
      </div>

      {/* Live events / Activity log */}
      <Card className="p-5">
        <h3 className="mb-4 text-sm font-semibold text-gray-900">
          {isCollecting ? "🔴 Live Collection Progress" : "📋 Recent Activity"}
        </h3>
        <ScrollArea className="h-64">
          <div className="space-y-2">
            {isCollecting &&
              liveEvents.map((event, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-2 text-sm ${
                    event.type === "error"
                      ? "text-red-600"
                      : event.type === "completed"
                        ? "text-green-600 font-medium"
                        : "text-gray-600"
                  }`}
                >
                  <span className="mt-0.5 text-xs text-gray-400">
                    {new Date().toLocaleTimeString()}
                  </span>
                  <span>{event.message}</span>
                </div>
              ))}

            {!isCollecting &&
              activity?.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-2 text-sm text-gray-600"
                >
                  <span className="mt-0.5 text-xs text-gray-400">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {log.type}
                  </Badge>
                  <span>{log.message}</span>
                </div>
              ))}

            {!isCollecting && (!activity || activity.length === 0) && (
              <p className="text-sm text-gray-400">
                No activity yet. Click &quot;Run Collection Now&quot; to start.
              </p>
            )}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: string;
  color?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <span className="text-xs font-medium text-gray-500">{label}</span>
      </div>
      <div className={`mt-1 text-2xl font-bold ${color ?? "text-gray-900"}`}>
        {value}
      </div>
    </Card>
  );
}
