import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { schedulerStatus } from "@/server/services/scheduler";

export const dynamic = "force-dynamic";

/** Three missed checks in a row means the scheduler has stopped. */
const STALE_CHECKS = 3;

/** For uptime monitors. Answers 503 when the database or the scheduler is not working. */
export async function GET() {
  let database = true;
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    database = false;
  }

  const scheduler = schedulerStatus();
  const lastCheck = scheduler.lastCheckAt?.getTime();
  // The first check runs a few seconds after start, so a fresh start counts as healthy.
  const schedulerOk =
    scheduler.started && (lastCheck === undefined || Date.now() - lastCheck < scheduler.checkEveryMs * STALE_CHECKS);

  const ok = database && schedulerOk;
  return NextResponse.json(
    { ok, database, scheduler: { started: scheduler.started, lastCheckAt: scheduler.lastCheckAt, healthy: schedulerOk } },
    { status: ok ? 200 : 503 },
  );
}
