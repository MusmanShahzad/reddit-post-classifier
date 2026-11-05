/**
 * Runs collection on the interval stored in App Settings.
 *
 * One check every 30 seconds decides whether a run is due. The gap is
 * counted from when the last run finished. The scheduler never queues a
 * run behind a running one, so a slow run cannot cause two paid runs in a
 * row. Turning automatic collection off stops every scheduled start, but a
 * run already on the queue still finishes.
 *
 * @module services/scheduler
 */

import { db } from "@/server/db";
import { clampInterval, nextDueAt } from "@/lib/schedule";
import { enqueueCollection, isCollectionActive, kickQueue, reconcileStaleRuns } from "./collection-runs";

const CHECK_EVERY_MS = 30_000;

const globalForScheduler = globalThis as unknown as {
  radarrSchedulerStarted?: boolean;
  radarrLastCheckAt?: Date;
};

/** For the health check: whether the scheduler started, and when it last checked. */
export function schedulerStatus() {
  return {
    started: Boolean(globalForScheduler.radarrSchedulerStarted),
    lastCheckAt: globalForScheduler.radarrLastCheckAt ?? null,
    checkEveryMs: CHECK_EVERY_MS,
  };
}

export function startScheduler(): void {
  if (globalForScheduler.radarrSchedulerStarted) return;
  globalForScheduler.radarrSchedulerStarted = true;
  const kickoff = setTimeout(() => void tick(), 5_000);
  kickoff.unref?.();
}

async function tick(): Promise<void> {
  try {
    await checkSchedule();
    globalForScheduler.radarrLastCheckAt = new Date();
  } catch (error) {
    console.error(
      "[scheduler] collection check failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
  } finally {
    const next = setTimeout(() => void tick(), CHECK_EVERY_MS);
    next.unref?.();
  }
}

/** One check: recovers stopped runs, continues the queue, and starts a run that is due. */
export async function checkSchedule(): Promise<void> {
  await reconcileStaleRuns(db);
  if (isCollectionActive()) return;

  // A queued run was already asked for, or was cut off part way. It always
  // continues, including with automatic runs off or another session open.
  const queued = await db.collectionRun.findFirst({ where: { status: "queued" } });
  if (queued) {
    await kickQueue(db);
    return;
  }

  const settings = await db.appSettings.findUnique({ where: { id: "default" } });
  if (!settings?.isOnboardingComplete || settings.autoCollectEnabled === false) return;

  // An older session has no saved answer, so it collects only while it is open.
  const sessions = await db.company.findMany({
    where: {
      searchQueries: { some: { isActive: true } },
      OR: [{ autoCollect: true }, { autoCollect: null, id: settings.activeCompanyId ?? "" }],
    },
    select: { id: true },
  });

  // Only one run goes at a time, so the session that has waited longest goes first.
  const interval = clampInterval(settings.collectionIntervalMins);
  const due: { id: string; at: number }[] = [];
  for (const session of sessions) {
    const last = await db.collectionRun.findFirst({
      where: { companyId: session.id, status: { not: "queued" } },
      orderBy: { startedAt: "desc" },
    });
    const at = nextDueAt(last, interval).getTime();
    if (at <= Date.now()) due.push({ id: session.id, at });
  }
  const next = due.sort((a, b) => a.at - b.at)[0];
  if (next) await enqueueCollection(db, next.id);
}
