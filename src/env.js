import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    REDDIT_CLIENT_ID: z.string().min(1),
    REDDIT_CLIENT_SECRET: z.string().min(1),
    TYPESAFE_API_KEY: z.string().min(1),
    OPENAI_API_KEY: z.string().min(1),
    COLLECTION_INTERVAL_MINUTES: z.coerce.number().default(30),
    RELEVANCE_THRESHOLD: z.coerce.number().default(0.6),
  },
  client: {},
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    REDDIT_CLIENT_ID: process.env.REDDIT_CLIENT_ID,
    REDDIT_CLIENT_SECRET: process.env.REDDIT_CLIENT_SECRET,
    TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    COLLECTION_INTERVAL_MINUTES: process.env.COLLECTION_INTERVAL_MINUTES,
    RELEVANCE_THRESHOLD: process.env.RELEVANCE_THRESHOLD,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
