/**
 * What the collection tracks share: settings, events, and progress updates.
 *
 * @module services/collection-shared
 */

import { env } from "@/env";
import type { db as dbType } from "@/server/db";

export type PrismaClient = typeof dbType;

/** Tunable values. Tests set the delay to 0. */
export const collectorConfig = {
  /** Delay in ms between successive Reddit API calls to stay under rate limits. */
  delayBetweenQueriesMs: 1500,
  /** Posts classified at the same time. */
  classifyConcurrency: 5,
  /** How often classification looks for newly saved posts while it has room. */
  classifyPollMs: 1000,
  /** The most posts kept from one search. 100 is the most a provider returns, so by default there is no limit. */
  maxPostsPerSearch: env.MAX_POSTS_PER_SEARCH ?? 100,
};

/**
 * Discriminated-union type for every event the collection pipeline can yield.
 *
 * The `type` field identifies the stage; each variant carries relevant data.
 */
export type CollectionEvent =
  | { type: "started"; message: string }
  | { type: "fetching"; query: string; message: string }
  | { type: "fetched"; query: string; count: number; message: string }
  | { type: "waiting"; until: Date; message: string }
  | { type: "resumed"; message: string }
  | { type: "dedup"; totalNew: number; totalSkipped: number; message: string }
  | { type: "classifying"; postTitle: string; message: string }
  | { type: "post_waiting"; until: Date; message: string }
  | { type: "classified"; postTitle: string; category: string; isRelevant: boolean; message: string }
  | { type: "summarizing"; current: number; total: number; message: string }
  | { type: "completed"; stats: CollectionStats; message: string }
  | { type: "error"; error: string; message: string };

/** Aggregate statistics for a completed (or partially-completed) collection run. */
export interface CollectionStats {
  totalFetched: number;
  totalNew: number;
  totalClassified: number;
  totalRelevant: number;
  totalFiltered: number;
  errorCount: number;
}

export interface ClassifyCompany {
  id: string;
  name: string;
  product: string;
  buyer: string;
  keepWhen: string;
  notAbout: string;
  goals: string;
  keywords: { id: string; type: string; value: string; aliases: string }[];
}

/** A wait in words. Log lines use lengths, because the server's clock may not match the reader's. */
export function waitWords(until: Date): string {
  const seconds = Math.max(1, Math.round((until.getTime() - Date.now()) / 1000));
  if (seconds === 1) return "1 second";
  if (seconds < 90) return `${seconds} seconds`;
  return `${Math.round(seconds / 60)} minutes`;
}

export async function saveProgress(db: PrismaClient, runId: string, stats: CollectionStats) {
  await db.collectionRun.update({ where: { id: runId }, data: { ...stats } });
}

/** Appends a log entry to a collection run. */
export async function logToRun(
  db: PrismaClient,
  runId: string,
  type: string,
  message: string,
) {
  await db.collectionLog.create({
    data: { runId, type, message },
  });
}
