// Runs the Prisma CLI with the default DATABASE_URL when none is set.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { databaseUrl } from "../src/lib/database-url.js";

// Read .env first, so the default never replaces a value set there.
if (existsSync(".env")) process.loadEnvFile(".env");

const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
const { status } = spawnSync(process.execPath, [prismaCli, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: databaseUrl() },
});

process.exit(status ?? 1);
