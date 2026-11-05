import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@generated/prisma";
import type { db as appDb } from "@/server/db";

export type TestDb = typeof appDb;

/**
 * A throwaway SQLite database built from prisma/schema.prisma. It never
 * touches prisma/dev.db and never calls a paid service.
 */
export async function createTestDb() {
  const dir = mkdtempSync(path.join(tmpdir(), "radarr-test-"));
  const url = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;

  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });

  const client = new PrismaClient({ datasourceUrl: url });

  return {
    db: client as unknown as TestDb,
    async reset() {
      await client.classificationLog.deleteMany();
      await client.chatMessage.deleteMany();
      await client.collectionLog.deleteMany();
      await client.collectionSearch.deleteMany();
      await client.collectionRun.deleteMany();
      await client.redditPost.deleteMany();
      await client.redditAuthor.deleteMany();
      await client.searchQuery.deleteMany();
      await client.subreddit.deleteMany();
      await client.keyword.deleteMany();
      await client.company.deleteMany();
    },
    async close() {
      await client.$disconnect();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows may hold the file for a moment. The temp folder is cleaned later.
      }
    },
  };
}

/** A company with three plain searches, the same shape onboarding creates. */
export async function seedCompany(db: TestDb, queries = ['"Alpha"', '"Beta"', '"Gamma"']) {
  const company = await db.company.create({ data: { name: "Acme" } });
  for (const query of queries) {
    await db.searchQuery.create({ data: { companyId: company.id, query, isCustom: false } });
  }
  await db.subreddit.create({ data: { companyId: company.id, name: "webdev" } });
  return company;
}
