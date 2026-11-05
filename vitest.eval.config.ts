import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

/** Measures the filter with real Jev calls, so it reads the real keys from `.env`. */
export default defineConfig({
  resolve: {
    alias: [
      { find: "@generated/prisma", replacement: path.resolve(import.meta.dirname, "./generated/prisma") },
      { find: "@", replacement: path.resolve(import.meta.dirname, "./src") },
    ],
  },
  test: {
    include: ["tests/eval/**/*.eval.ts"],
    environment: "node",
    testTimeout: 900_000,
    env: loadEnv("test", import.meta.dirname, ""),
  },
});
