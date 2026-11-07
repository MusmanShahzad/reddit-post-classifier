import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Anything here that is newer than the build means the build is out of date. */
const BUILD_INPUTS = ["src", "public", "next.config.js", "package-lock.json", "prisma/schema.prisma"];

/**
 * @param {string} path
 * @returns {number} When the file, or the newest file in the folder, last changed.
 */
function newestChange(path) {
  if (!existsSync(path)) return 0;
  const stats = statSync(path);
  if (!stats.isDirectory()) return stats.mtimeMs;
  return Math.max(0, ...readdirSync(path).map((name) => newestChange(join(path, name))));
}

/**
 * Whether the app must be built before it can start.
 *
 * @param {string} [root] - The project folder.
 * @returns {boolean} True when the build is missing or older than the code.
 */
export function needsBuild(root = process.cwd()) {
  const buildId = join(root, ".next", "BUILD_ID");
  if (!existsSync(buildId)) return true;
  const builtAt = statSync(buildId).mtimeMs;
  return BUILD_INPUTS.some((input) => newestChange(join(root, input)) > builtAt);
}
