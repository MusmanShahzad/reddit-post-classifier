import { SESSION_HEADER } from "@/lib/session-header";
import type { db as dbType } from "@/server/db";

type PrismaClient = typeof dbType;

/**
 * The session a request is for. Each browser tab names its own, so two tabs can
 * show different sessions. Anything that names none, or a session that no longer
 * exists, gets the most recently opened one. Null before the first onboarding.
 */
export async function activeSessionId(ctx: { db: PrismaClient; headers?: Headers }): Promise<string | null> {
  const requested = ctx.headers?.get(SESSION_HEADER);
  if (requested) {
    const company = await ctx.db.company.findUnique({ where: { id: requested }, select: { id: true } });
    if (company) return company.id;
  }
  const settings = await ctx.db.appSettings.findUnique({
    where: { id: "default" },
    select: { activeCompanyId: true },
  });
  return settings?.activeCompanyId ?? null;
}
