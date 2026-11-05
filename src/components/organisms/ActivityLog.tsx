import { useEffect, useMemo, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  Clock3,
  History,
  Inbox,
  type LucideIcon,
  Play,
  Search,
  Sparkles,
  StickyNote,
} from "lucide-react";
import { activityRuns, type ActivityEntry, type ActivityItem, type ActivityKind, type ActivityRun, type ActivityTone } from "@/lib/activity";
import { timeAgo } from "@/lib/types";

export type { ActivityEntry };
export type LiveEvent = ActivityEntry;

/**
 * What collection has been doing, as a story a person can scan. Each run is one
 * group, repeated lines become one item, and problems can be filtered to. During
 * a run the live lines sit on top of the earlier runs.
 *
 * @param isCollecting - Whether a collection is in progress.
 * @param liveEvents   - Log lines from the running collection.
 * @param activity     - Recent log lines from every run.
 *
 * @example
 * ```tsx
 * <ActivityLog isCollecting={isCollecting} liveEvents={liveEvents} activity={activity} />
 * ```
 */
export interface ActivityLogProps {
  isCollecting: boolean;
  liveEvents: ActivityEntry[];
  activity: ActivityEntry[];
}

const RUNS_SHOWN = 4;
/** Keeps "5m ago" current between refreshes. */
const CLOCK_TICK_MS = 30_000;

const ICONS: Record<ActivityKind, LucideIcon> = {
  start: Play,
  search: Search,
  found: Search,
  posts: Sparkles,
  wait: Clock3,
  done: CircleCheck,
  problem: CircleAlert,
  note: StickyNote,
};

const TONES: Record<ActivityTone, string> = {
  neutral: "bg-base-200 text-base-content/70",
  info: "bg-info/15 text-info",
  success: "bg-success/15 text-success",
  warning: "bg-warning/20 text-warning",
  error: "bg-error/15 text-error",
};

const RUN_BADGE: Record<string, string> = {
  running: "badge-info",
  queued: "badge-ghost",
  completed: "badge-success badge-soft",
  failed: "badge-error badge-soft",
};

function runTime(date: Date): string {
  const today = new Date().toDateString() === date.toDateString();
  const clock = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return today ? `Today, ${clock}` : `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${clock}`;
}

function Item({ item }: { item: ActivityItem }) {
  const Icon = ICONS[item.kind];
  return (
    <li className="flex animate-rise-in gap-3">
      <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${TONES[item.tone]}`} aria-hidden>
        {item.kind === "search" ? <span className="loading loading-spinner size-3.5" /> : <Icon className="size-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className={`min-w-0 text-sm font-medium ${item.tone === "error" ? "text-error" : ""}`}>{item.title}</p>
          <time
            className="shrink-0 text-xs text-base-content/50"
            dateTime={item.timestamp.toISOString()}
            title={item.timestamp.toLocaleString()}
          >
            {timeAgo(item.timestamp)}
          </time>
        </div>
        {item.query && (
          <code className="block truncate text-xs text-base-content/60" title={item.query}>
            {item.query}
          </code>
        )}
        {item.detail && <p className="text-xs text-base-content/70">{item.detail}</p>}
        {item.chips && item.chips.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {item.chips.map((chip) => (
              <span key={chip} className="badge badge-ghost badge-xs">
                {chip}
              </span>
            ))}
          </div>
        )}
        {item.posts && (
          <details className="mt-1 text-xs">
            <summary className="link-hover cursor-pointer text-base-content/60">Show posts</summary>
            <ul className="mt-1 space-y-1">
              {item.posts.map((post, index) => (
                <li key={`${post.title}-${index}`} className="flex items-baseline gap-2">
                  <span className={`badge badge-xs shrink-0 ${post.kept ? "badge-success badge-soft" : "badge-ghost"}`}>
                    {post.kept ? post.label || "Kept" : "Filtered"}
                  </span>
                  <span className="min-w-0 truncate text-base-content/70" title={post.title}>
                    {post.title}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </li>
  );
}

function Run({ run, open, live }: { run: ActivityRun; open: boolean; live: boolean }) {
  return (
    <details open={open} className="group rounded-box border border-base-300" data-testid="activity-run">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 p-3 text-sm [&::-webkit-details-marker]:hidden">
        <span className="font-medium">{runTime(run.startedAt)}</span>
        {run.status && (
          <span className={`badge badge-xs gap-1 ${RUN_BADGE[run.status] ?? "badge-ghost"}`}>
            {run.status === "running" ? "In progress" : run.status === "completed" ? "Finished" : run.status === "failed" ? "Failed" : "Queued"}
          </span>
        )}
        {run.chips.map((chip) => (
          <span key={chip} className="badge badge-ghost badge-xs">
            {chip}
          </span>
        ))}
        {run.problems > 0 && (
          <span className="badge badge-warning badge-xs">{run.problems} to note</span>
        )}
        <span className="ml-auto text-xs text-base-content/50 group-open:hidden">
          {run.items.length} {run.items.length === 1 ? "event" : "events"}
        </span>
      </summary>
      <ul className="space-y-3 px-3 pb-3" {...(live ? { role: "log", "aria-live": "polite" as const } : {})}>
        {run.items.map((item) => (
          <Item key={item.id} item={item} />
        ))}
      </ul>
    </details>
  );
}

export function ActivityLog({ isCollecting, liveEvents, activity }: ActivityLogProps) {
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const runs = useMemo(() => {
    const seen = new Set<string>();
    const merged = (isCollecting ? [...liveEvents, ...activity] : activity).filter((entry) => {
      if (!entry.id) return true;
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
    return activityRuns(merged);
  }, [isCollecting, liveEvents, activity]);

  const problems = runs.reduce((total, run) => total + run.problems, 0);
  const filtering = onlyProblems && problems > 0;
  const matching = filtering
    ? runs
        .map((run) => ({ ...run, items: run.items.filter((item) => item.problem) }))
        .filter((run) => run.items.length > 0)
    : runs;
  const shown = showAll ? matching : matching.slice(0, RUNS_SHOWN);

  return (
    <div className="card card-border bg-base-100">
      <div className="card-body gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="card-title text-base">
            {isCollecting ? (
              <span className="inline-grid *:[grid-area:1/1]" aria-hidden>
                <span className="status status-info animate-ping" />
                <span className="status status-info" />
              </span>
            ) : (
              <History className="size-4" aria-hidden />
            )}
            {isCollecting ? "Live collection" : "Recent activity"}
          </h3>
          {problems > 0 && (
            <div className="join" role="group" aria-label="Filter activity">
              <button
                type="button"
                className={`btn btn-xs join-item ${filtering ? "" : "btn-active"}`}
                aria-pressed={!filtering}
                onClick={() => setOnlyProblems(false)}
              >
                All
              </button>
              <button
                type="button"
                className={`btn btn-xs join-item gap-1 ${filtering ? "btn-active" : ""}`}
                aria-pressed={filtering}
                onClick={() => setOnlyProblems(true)}
              >
                Problems
                <span className="badge badge-warning badge-xs">{problems}</span>
              </button>
            </div>
          )}
        </div>

        <div className="max-h-[28rem] space-y-2 overflow-y-auto">
          {shown.map((run, index) => (
            <Run key={run.id} run={run} open={index === 0 || filtering} live={isCollecting && index === 0} />
          ))}

          {shown.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-base-content/60">
              {isCollecting ? (
                <>
                  <span className="loading loading-dots loading-sm" aria-hidden />
                  Starting collection
                </>
              ) : (
                <>
                  <Inbox className="size-6" aria-hidden />
                  No activity yet. Run a collection to start.
                </>
              )}
            </div>
          )}

          {!showAll && matching.length > RUNS_SHOWN && (
            <button type="button" className="btn btn-ghost btn-sm btn-block" onClick={() => setShowAll(true)}>
              Show {matching.length - RUNS_SHOWN} older {matching.length - RUNS_SHOWN === 1 ? "run" : "runs"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
