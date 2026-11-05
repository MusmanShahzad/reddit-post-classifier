import { RefreshCw } from "lucide-react";
import { CollectionStats } from "@/components/molecules";

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
  } | null;
}

export function CollectionStatusPanel({
  lastRun,
  isCollecting,
  onRunCollection,
  schedule,
}: CollectionStatusPanelProps) {
  const waitingUntil = lastRun?.waitingUntil ? new Date(lastRun.waitingUntil) : null;
  const shownStatus = waitingUntil ? "waiting" : lastRun?.status;

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
            {shownStatus}
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
      {schedule && (
        <p className="text-sm text-base-content/70">
          {schedule.autoCollectEnabled === false
            ? "Automatic collection is off. Press Run collection to collect."
            : `Runs ${schedule.intervalMins} min after the last one finishes.`}
          {schedule.queued
            ? " One run is waiting in the queue."
            : schedule.autoCollectEnabled === false || isCollecting
              ? ""
              : new Date(schedule.nextRunAt).getTime() <= Date.now()
                ? " The next run is due and will start in the background."
                : ` Next run ${new Date(schedule.nextRunAt).toLocaleString()}.`}
        </p>
      )}
      </div>
    </div>
  );
}
