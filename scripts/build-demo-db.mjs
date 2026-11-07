// Makes prisma/demo.db, the public copy of prisma/dev.db that a fresh clone starts with.
// Run it with `npm run db:demo` after the local data changes.
import { spawnSync } from "node:child_process";
import { copyFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PrismaClient } = require("../generated/prisma");

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?<![\w/.-])\+?\d(?:[\s().-]?\d){9,13}(?![\w/-])/g;
/** Text people wrote, or text copied from it. Links and ids are left alone. */
const WRITTEN_TEXT = {
  RedditPost: ["title", "body", "searchSnippet", "reason"],
  ClassificationLog: ["claim", "state", "reason", "answersJson"],
  CollectionLog: ["message"],
  ChatMessage: ["content", "metadata"],
};

const mask = (text) => text.replace(EMAIL, "[email removed]").replace(PHONE, "[phone removed]");

rmSync("prisma/demo.db", { force: true });
copyFileSync("prisma/dev.db", "prisma/demo.db");

// Match the current schema, so `npm run db:push` has nothing to change on a clone.
const prismaCli = require.resolve("prisma/build/index.js");
const pushed = spawnSync(process.execPath, [prismaCli, "db", "push", "--accept-data-loss", "--skip-generate"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: "file:./demo.db" },
});
if (pushed.status !== 0) process.exit(pushed.status ?? 1);

const db = new PrismaClient({ datasourceUrl: "file:./demo.db" });
let masked = 0;

await db.$executeRawUnsafe(`UPDATE "RedditPost" SET "rawJson" = ''`);
await db.$executeRawUnsafe(`UPDATE "RedditAuthor" SET "rawJson" = ''`);
// A clone must not spend its owner's credits until they turn collection on.
await db.$executeRawUnsafe(`UPDATE "Company" SET "autoCollect" = 0`);
await db.$executeRawUnsafe(`UPDATE "AppSettings" SET "autoCollectEnabled" = 0, "authorLookupsEnabled" = 0`);

for (const [table, columns] of Object.entries(WRITTEN_TEXT)) {
  const rows = await db.$queryRawUnsafe(`SELECT "id", ${columns.map((c) => `"${c}"`).join(", ")} FROM "${table}"`);
  for (const row of rows) {
    for (const column of columns) {
      const value = row[column];
      if (typeof value !== "string" || mask(value) === value) continue;
      await db.$executeRawUnsafe(`UPDATE "${table}" SET "${column}" = ? WHERE "id" = ?`, mask(value), row.id);
      masked += 1;
    }
  }
}

// Without this, the removed data stays readable inside the file.
await db.$executeRawUnsafe("VACUUM");
await db.$disconnect();

console.log(`prisma/demo.db is ready. Masked contact details in ${masked} fields.`);
