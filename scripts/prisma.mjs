// Runs the Prisma CLI with the default DATABASE_URL when none is set.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { databaseUrl, DEFAULT_DATABASE_URL } from "../src/lib/database-url.js";

// Read .env first, so the default never replaces a value set there.
if (existsSync(".env")) process.loadEnvFile(".env");

const url = databaseUrl();
const args = process.argv.slice(2);

// A fresh clone starts with the demo data. An existing database is never replaced.
const LOCAL_DB = "prisma/dev.db";
const DEMO_DB = "prisma/demo.db";
if (args[0] === "db" && args[1] === "push" && url === DEFAULT_DATABASE_URL && !existsSync(LOCAL_DB) && existsSync(DEMO_DB)) {
  copyFileSync(DEMO_DB, LOCAL_DB);
  console.log(`Loaded the demo data into ${LOCAL_DB}.`);
}

const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
const { status } = spawnSync(process.execPath, [prismaCli, ...args], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});

process.exit(status ?? 1);
