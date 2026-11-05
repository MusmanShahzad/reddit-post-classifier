import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";

const dirname =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: "@generated/prisma",
        replacement: path.resolve(dirname, "./generated/prisma"),
      },
      {
        find: "@",
        replacement: path.resolve(dirname, "./src"),
      },
    ],
  },
  test: {
    // Tests never use real keys or a real database, so they need no setup and cannot spend anything.
    env: {
      DATABASE_URL: "file:./unused-by-tests.db",
      REDDIT_PROVIDER: "scrapebadger",
      SCRAPEBADGER_API_KEY: "test-key",
      REDDIT_CLIENT_ID: "test-id",
      REDDIT_CLIENT_SECRET: "test-secret",
      TYPESAFE_API_KEY: "test-key",
      OPENAI_API_KEY: "test-key",
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          environment: "node",
          globals: true,
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: "components",
          include: ["tests/components/**/*.test.tsx"],
          environment: "jsdom",
          globals: true,
          setupFiles: ["./tests/setup.ts"],
        },
      },
    ],
  },
});
