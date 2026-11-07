import { useEffect, useState } from "react";
import { Clock3, RefreshCw } from "lucide-react";
import { AnimatedText } from "@/components/atoms";
import { CollectionStats } from "@/components/molecules";
import { countdown } from "@/lib/schedule";

/**
 * Dashboard card showing last collection run status with a "Run Now" button.
 *
 * Combines the run status badge, stats grid, and action button into one panel.
 *
 * @param lastRun       - Data from the last collection run (or `null` if none).
 * @param isCollecting  - Whether a collection is currently in progress.
 * @param onRunCollection - Called when the user clicks "Run Collection Now".
 *
 * @example
 * ```tsx
 * <CollectionStatusPanel
 *   lastRun={lastRun}
 *   isCollecting={isCollecting}
 *   onRunCollection={startCollection}
 * />
 * ```
 */
export interface LastRunData {
  status: string;
  startedAt: Date | string;
  totalFetched: number;
  totalNew: number;
  totalRelevant: number;
  /** Set while the source has told the queue to wait. */
  waitingUntil?: Date | string | null;
}

const STATUS_BADGE: Record<string, string> = {
  running: "badge-info",
  waiting: "badge-warning",
  completed: "badge-success",
  failed: "badge-error",
};

export interface CollectionStatusPanelProps {
  lastRun: LastRunData | null;
  isCollecting: boolean;
  onRunCollection: () => void;
  schedule?: {
    intervalMins: number;
    nextRunAt: Date | string;
    queued: boolean;
    /** False when the user turned automatic runs off. Defaults to on. */
    autoCollectEnabled?: boolean;
    /** False when the scheduler will not run this session by itself. Defaults to on. */
    scheduled?: boolean;
  } | null;
}

/** What the line under the button says about automatic runs. */
function scheduleNote(schedule: NonNullable<CollectionStatusPanelProps["schedule"]>): string {
  const queued = schedule.queued ? " One run is waiting in the queue." : "";
  if (schedule.autoCollectEnabled === false) {
    return `Automatic collection is off. Press Run collection to collect.${queued}`;
  }
  if (schedule.scheduled === false) {
    return `This session is not on the schedule. Press Run collection to collect, or include it in Settings.${queued}`;
  }
  return `Runs ${schedule.intervalMins} min after the last one finishes.${queued}`;
}

export function CollectionStatusPanel({
  lastRun,
  isCollecting,
  onRunCollection,
  schedule,
}: CollectionStatusPanelProps) {
  const waitingUntil = lastRun?.waitingUntil ? new Date(lastRun.waitingUntil) : null;
  const shownStatus = waitingUntil ? "waiting" : lastRun?.status;

  const counting = Boolean(
    schedule && schedule.autoCollectEnabled !== false && schedule.scheduled !== false && !schedule.queued && !isCollecting,
  );
  const [now, setNow] = useState(() => Date.now());

  // The time left moves every second, between refreshes from the server.
  useEffect(() => {
    if (!counting) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting]);

  const timeLeft = schedule ? new Date(schedule.nextRunAt).getTime() - now : 0;

  return (
    <div className="card card-border bg-base-100">
      <div className="card-body">
      <div className="flex items-center justify-between">
        <h3 className="card-title text-base">Collection Status</h3>
        {lastRun && (
          <span className={`badge gap-1.5 ${STATUS_BADGE[shownStatus ?? ""] ?? "badge-outline"}`}>
            {shownStatus === "running" && (
              <span className="loading loading-spinner loading-xs" />
            )}
            <AnimatedText text={shownStatus ?? ""} />
          </span>
        )}
      </div>


      {lastRun && (
        <div className="mb-4">
          <CollectionStats
            startedAt={lastRun.startedAt}
            totalFetched={lastRun.totalFetched}
            totalNew={lastRun.totalNew}
            totalRelevant={lastRun.totalRelevant}
          />
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary btn-block"
        onClick={onRunCollection}
        disabled={isCollecting}
      >
        {isCollecting ? (
          <>
            <span className="loading loading-spinner loading-xs" />
            {waitingUntil ? "Waiting" : "Collecting"}
          </>
        ) : (
          <>
            <RefreshCw className="size-4" aria-hidden />
            Run collection
          </>
        )}
      </button>
      {counting && (
        <p data-testid="next-run" className="flex items-center gap-2 text-sm font-medium">
          <Clock3 className="size-4 shrink-0" aria-hidden />
          {timeLeft > 0 ? (
            // This moves every second, so it must not fade each time.
            <span>
              Next run in <span className="tabular-nums">{countdown(timeLeft)}</span>
            </span>
          ) : (
            <span>The next run is due and will start in the background.</span>
          )}
        </p>
      )}
      {schedule && (
        <p className="text-sm text-base-content/70">
          <AnimatedText text={scheduleNote(schedule)} />
        </p>
      )}
      </div>
    </div>
  );
}
