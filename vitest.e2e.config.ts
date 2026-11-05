import path from "node:path";
import { defineConfig } from "vitest/config";

/** The end-to-end test: real production build and a real browser, with paid services faked. */
export default defineConfig({
  resolve: {
    alias: [{ find: "@generated/prisma", replacement: path.resolve(import.meta.dirname, "./generated/prisma") }],
  },
  test: {
    include: ["tests/e2e/**/*.e2e.ts"],
    environment: "node",
    testTimeout: 180_000,
    hookTimeout: 300_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
