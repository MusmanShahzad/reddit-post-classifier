import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { PrismaClient } from "@generated/prisma";
import { afterAll, describe, expect, it } from "vitest";

const db = new PrismaClient({ datasourceUrl: "file:./demo.db" });
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

describe("the public demo database", () => {
  afterAll(() => db.$disconnect());

  it("has the sessions and posts a reviewer should see", async () => {
    expect(await db.company.count()).toBeGreaterThan(0);
    expect(await db.redditPost.count({ where: { status: "new" } })).toBeGreaterThan(0);
  });

  it("holds no raw Reddit data or email addresses", async () => {
    expect(await db.redditPost.count({ where: { rawJson: { not: "" } } })).toBe(0);
    expect(await db.redditAuthor.count({ where: { rawJson: { not: "" } } })).toBe(0);
    const posts = await db.redditPost.findMany({ select: { title: true, body: true, searchSnippet: true, reason: true } });
    const leaked = posts.filter((post) => Object.values(post).some((text) => typeof text === "string" && EMAIL.test(text)));
    expect(leaked).toEqual([]);
  });

  it("matches the current schema, so db:push works on a fresh clone", () => {
    const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
    const diff = spawnSync(
      process.execPath,
      [prismaCli, "migrate", "diff", "--from-url", `file:${resolve("prisma/demo.db")}`, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"],
      { encoding: "utf8" },
    );
    expect(diff.stdout + diff.stderr).toContain("No difference detected");
    expect(diff.status).toBe(0);
  }, 30_000);

  it("cannot spend credits or leave work to resume on a fresh clone", async () => {
    const settings = await db.appSettings.findFirst();
    expect(settings?.autoCollectEnabled).toBe(false);
    expect(settings?.authorLookupsEnabled).toBe(false);
    expect(await db.company.count({ where: { NOT: { autoCollect: false } } })).toBe(0);
    expect(await db.collectionRun.count({ where: { status: { in: ["queued", "running"] } } })).toBe(0);
    expect(await db.redditPost.count({ where: { status: "pending" } })).toBe(0);
  });
});
