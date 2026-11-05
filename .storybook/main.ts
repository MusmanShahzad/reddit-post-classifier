import type { StorybookConfig } from "@storybook/nextjs-vite";
import path from "path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: [
    "../src/components/**/*.mdx",
    "../src/components/**/*.stories.@(js|jsx|mjs|ts|tsx)",
  ],
  addons: [
    "@chromatic-com/storybook",
    "@storybook/addon-vitest",
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
  ],
  framework: "@storybook/nextjs-vite",
  staticDirs: ["../public"],
  viteFinal: async (config) => {
    config.resolve = config.resolve ?? {};
    const current = config.resolve.alias;
    const entries = Array.isArray(current)
      ? current
      : Object.entries(current ?? {}).map(([find, replacement]) => ({ find, replacement }));
    config.resolve.alias = [
      ...entries,
      {
        find: "@generated/prisma",
        replacement: path.resolve(dirname, "../generated/prisma"),
      },
      { find: "@", replacement: path.resolve(dirname, "../src") },
    ];
    return config;
  },
};

export default config;
