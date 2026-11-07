import { useEffect, useState } from "react";
import { Clock3, WifiOff } from "lucide-react";
import { AnimatedNumber, AnimatedProgress, AnimatedText } from "@/components/atoms";
import { countdown } from "@/lib/schedule";

export interface LiveStatusProps {
  run?: {
    status: string;
    waitingUntil?: Date | string | null;
    waitReason?: string | null;
    totalNew: number;
    totalClassified: number;
    totalRelevant: number;
    searches: { status: string }[];
  } | null;
  /** Saved posts still waiting for classification. */
  pending?: number;
  /** Of those, how many a rate limit has delayed. */
  rateLimited?: number;
  /** The last refresh failed, so what is shown may be out of date. */
  disconnected?: boolean;
}

const FINISHED = new Set(["done", "failed"]);

/**
 * The live banner above every tab: what the run is doing right now, how far it
 * has got, and how long a wait has left. Renders nothing when nothing is happening.
 */
export function LiveStatus({ run, pending = 0, rateLimited = 0, disconnected = false }: LiveStatusProps) {
  const waitingUntil = run?.waitingUntil ? new Date(run.waitingUntil) : null;
  const [now, setNow] = useState(() => Date.now());

  // The countdown moves every second, between refreshes from the server.
  useEffect(() => {
    if (!waitingUntil) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [Boolean(waitingUntil)]); // eslint-disable-line react-hooks/exhaustive-deps

  if (disconnected) {
    return (
      <div role="status" className="alert alert-error alert-soft mb-4">
        <WifiOff className="size-4" aria-hidden />
        <span>Cannot reach the server. Showing the last update and retrying.</span>
      </div>
    );
  }

  const running = run?.status === "running";
  const queued = run?.status === "queued";
  if (!running && !queued) return null;

  const searches = (run?.searches ?? []).filter((search) => search.status !== "skipped");
  const finished = searches.filter((search) => FINISHED.has(search.status)).length;
  const headline = waitingUntil
    ? "Searches paused, continuing in"
    : queued
      ? "Waiting for a turn to collect"
      : finished < searches.length
        ? `Searching ${finished + 1} of ${searches.length}`
        : pending > 0
          ? "Classifying the new posts"
          : "Finishing up";

  return (
    <div
      role="status"
      data-testid="live-status"
      className={`card card-border mb-4 border-l-4 bg-base-100 ${waitingUntil ? "border-l-warning" : "border-l-info"}`}
    >
      <div className="card-body gap-3 p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {waitingUntil ? (
            <Clock3 className="size-4 shrink-0 text-warning" aria-hidden />
          ) : (
            <span className="inline-grid *:[grid-area:1/1]" aria-hidden>
              <span className={`status status-info ${queued ? "" : "animate-ping"}`} />
              <span className="status status-info" />
            </span>
          )}
          <span className="font-semibold">
            <AnimatedText text={headline} />
            {/* This moves every second, so it must not fade each time. */}
            {waitingUntil && <span className="tabular-nums"> {countdown(waitingUntil.getTime() - now)}</span>}
          </span>
          <span className="badge badge-ghost badge-sm">Live</span>
          <span className="flex flex-wrap gap-1.5 sm:ml-auto">
            <span className="badge badge-sm badge-outline"><AnimatedNumber value={run?.totalNew ?? 0} /> new</span>
            <span className="badge badge-sm badge-outline"><AnimatedNumber value={run?.totalClassified ?? 0} /> classified</span>
            <span className="badge badge-sm badge-success"><AnimatedNumber value={run?.totalRelevant ?? 0} /> kept</span>
            {pending > 0 && <span className="badge badge-sm badge-outline"><AnimatedNumber value={pending} /> waiting</span>}
            {rateLimited > 0 && <span className="badge badge-sm badge-warning"><AnimatedNumber value={rateLimited} /> rate limited</span>}
          </span>
        </div>
        {waitingUntil && run?.waitReason && (
          <p className="text-sm text-base-content/70">
            {run.waitReason} No search is skipped, and classification carries on.
          </p>
        )}
        {searches.length > 0 && (
          <AnimatedProgress
            className={`progress h-1.5 w-full ${waitingUntil ? "progress-warning" : "progress-info"}`}
            value={finished}
            max={searches.length}
            aria-label="Searches finished"
          />
        )}
      </div>
    </div>
  );
}
