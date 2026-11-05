/** Smallest and largest gap between automatic runs, in minutes. */
export const MIN_INTERVAL_MINS = 5;
export const MAX_INTERVAL_MINS = 1440;
export const DEFAULT_INTERVAL_MINS = 30;

/** Keeps a stored interval inside the allowed range. */
export function clampInterval(minutes: number | null | undefined): number {
  if (!minutes || !Number.isFinite(minutes) || minutes < MIN_INTERVAL_MINS) {
    return DEFAULT_INTERVAL_MINS;
  }
  return Math.min(Math.round(minutes), MAX_INTERVAL_MINS);
}

interface RunTimes {
  status: string;
  startedAt: Date;
  completedAt: Date | null;
}

/**
 * When the next automatic run is due. The gap is counted from the moment
 * the last run finished, so a slow run never makes the next one start
 * straight away and spend credits twice in a row.
 */
export function nextDueAt(
  last: RunTimes | null,
  intervalMins: number,
  now: Date = new Date(),
): Date {
  if (!last) return now;
  const base = last.status === "running" ? now : (last.completedAt ?? last.startedAt);
  return new Date(base.getTime() + intervalMins * 60_000);
}
