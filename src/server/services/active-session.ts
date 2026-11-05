import type { db as dbType } from "@/server/db";

type PrismaClient = typeof dbType;

/** The session the app is showing. Null before the first onboarding. */
export async function activeSessionId(db: PrismaClient): Promise<string | null> {
  const settings = await db.appSettings.findUnique({
    where: { id: "default" },
    select: { activeCompanyId: true },
  });
  return settings?.activeCompanyId ?? null;
}
