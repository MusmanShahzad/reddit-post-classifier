/**
 * Background collection runs.
 *
 * Runs wait in the database. One company has at most one running run and one
 * queued run. If the server stops, unfinished searches go back on the queue
 * and finished searches are not fetched again.
 *
 * @module services/collection-runs
 */

import type { db as dbType } from "@/server/db";
import { runCollection } from "./collector";
import {
  ensureQueuedRun,
  findLiveRun,
  recoverOrphanedRuns,
  settleInterruptedRun,
  touchRun,
} from "./search-queue";

type PrismaClient = typeof dbType;

const HEARTBEAT_EVERY_MS = 15_000;

const globalForRuns = globalThis as unknown as {
  radarrActiveRuns?: Set<string>;
  radarrStartLock?: boolean;
};

const activeRuns = (globalForRuns.radarrActiveRuns ??= new Set<string>());

export function isCollectionActive(): boolean {
  return activeRuns.size > 0 || Boolean(globalForRuns.radarrStartLock);
}

/**
 * Settles runs that say "running" but have no worker: this process is not
 * working on them and their heartbeat is old.
 */
export async function reconcileStaleRuns(db: PrismaClient): Promise<void> {
  await recoverOrphanedRuns(db, (runId) => activeRuns.has(runId));
}

export type StartCollectionResult =
  | { ok: true; runId: string; queued: boolean }
  | { ok: false; runId: string; reason: "already_running"; queued: true };

/**
 * Starts a collection now, or keeps one follow-up run on the queue.
 */
export async function enqueueCollection(
  db: PrismaClient,
  companyId: string,
): Promise<StartCollectionResult> {
  if (globalForRuns.radarrStartLock || activeRuns.size > 0) {
    const queued = await ensureQueuedRun(db, companyId);
    return { ok: true, runId: queued.id, queued: true };
  }

  const started = await startCollection(db, companyId);
  if (!started.ok) {
    const queued = await ensureQueuedRun(db, companyId);
    return { ok: false, runId: queued.id, reason: "already_running", queued: true };
  }
  return { ok: true, runId: started.runId, queued: false };
}

/** Starts the oldest queued run when the worker is idle. */
export async function kickQueue(db: PrismaClient): Promise<void> {
  if (globalForRuns.radarrStartLock || activeRuns.size > 0) return;
  const next = await db.collectionRun.findFirst({
    where: { status: "queued" },
    orderBy: { startedAt: "asc" },
  });
  if (!next) return;
  await startCollection(db, next.companyId);
}

async function startCollection(
  db: PrismaClient,
  companyId: string,
): Promise<{ ok: true; runId: string } | { ok: false; runId: string }> {
  if (globalForRuns.radarrStartLock || activeRuns.size > 0) {
    return { ok: false, runId: [...activeRuns][0] ?? "" };
  }

  globalForRuns.radarrStartLock = true;
  try {
    await reconcileStaleRuns(db);

    // Another worker may own a run. Never start a second paid run beside it.
    const live = await findLiveRun(db, companyId);
    if (live) return { ok: false, runId: live.id };

    const queued = await db.collectionRun.findFirst({
      where: { companyId, status: "queued" },
      orderBy: { startedAt: "asc" },
    });

    let runId: string;
    if (queued) {
      await db.collectionRun.update({
        where: { id: queued.id },
        data: { status: "running", completedAt: null, heartbeatAt: new Date() },
      });
      runId = queued.id;
    } else {
      const created = await db.collectionRun.create({
        data: { companyId, status: "running", heartbeatAt: new Date() },
      });
      runId = created.id;
    }

    activeRuns.add(runId);
    launch(db, companyId, runId);
    return { ok: true, runId };
  } finally {
    globalForRuns.radarrStartLock = false;
  }
}

function launch(db: PrismaClient, companyId: string, runId: string): void {
  drain(db, companyId, runId).catch((error: unknown) => {
    console.error(
      "[collection] worker crashed:",
      error instanceof Error ? error.message : "Unknown error",
    );
  });
}

async function drain(db: PrismaClient, companyId: string, runId: string) {
  const heartbeat = setInterval(() => {
    touchRun(db, runId).catch(() => undefined);
  }, HEARTBEAT_EVERY_MS);
  heartbeat.unref?.();

  try {
    for await (const event of runCollection(db, companyId, runId)) {
      if (event.type === "classifying") continue;
      const message =
        event.type === "error" && event.error !== event.message
          ? `${event.message}: ${event.error}`
          : event.message;
      // A log line that cannot be written must not stop the searches.
      await db.collectionLog
        .create({ data: { runId, type: event.type, message } })
        .catch((error: unknown) => {
          console.warn(
            "[collection] could not write a log line:",
            error instanceof Error ? error.message : "Unknown error",
          );
        });
    }
  } catch (error) {
    await db.collectionLog
      .create({
        data: {
          runId,
          type: "error",
          message: `Collection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
      })
      .catch(() => undefined);
  } finally {
    clearInterval(heartbeat);
    activeRuns.delete(runId);
    try {
      await settleInterruptedRun(db, runId);
      await kickQueue(db);
    } catch (error) {
      console.error(
        "[collection] could not settle run:",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }
}
