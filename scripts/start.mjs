// Starts the production app, building it first only when that is needed.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { needsBuild } from "./build-check.mjs";

const nextCli = createRequire(import.meta.url).resolve("next/dist/bin/next");

function runNext(args) {
  return spawnSync(process.execPath, [nextCli, ...args], { stdio: "inherit" }).status ?? 1;
}

if (needsBuild()) {
  console.log("Building the app first. This takes a minute or two and only runs when the code has changed.");
  const status = runNext(["build"]);
  if (status !== 0) process.exit(status);
}

process.exit(runNext(["start", ...process.argv.slice(2)]));
