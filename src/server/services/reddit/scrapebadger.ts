/**
 * ScrapeBadger provider.
 *
 * One HTTPS call per search against `https://scrapebadger.com/v1/reddit`.
 * Select it with `REDDIT_PROVIDER=scrapebadger` and set `SCRAPEBADGER_API_KEY`.
 *
 * Post search:  GET /v1/reddit/search/posts
 * Subreddits:   GET /v1/reddit/search/subreddits
 * Auth header:  X-API-Key
 */

import { fetchWithRetry, ProviderWaitError, subredditNames } from "./http";
import { MAX_QUERY_BYTES, searchBytes } from "./queries";
import {
  toRedditAuthor,
  type RedditAuthorRaw,
  type RedditPostRaw,
  type RedditProvider,
  type RedditSearchOptions,
  type RedditUserPayload,
  type SubredditInfo,
} from "./types";

/** Read on each call, so the end-to-end tests can point at a local stand-in. */
const apiBase = () => process.env.SCRAPEBADGER_BASE_URL ?? "https://scrapebadger.com/v1/reddit";

interface ScrapeBadgerPost {
  id?: string;
  fullname?: string;
  title?: string;
  selftext?: string;
  subreddit?: string;
  author?: string;
  score?: number;
  num_comments?: number;
  url?: string;
  permalink?: string;
  created_utc?: number;
  is_self?: boolean;
  link_flair_text?: string | null;
}

interface ScrapeBadgerSubreddit {
  name?: string;
  subscribers?: number;
  public_description?: string;
}

function apiKey(): string {
  const key = process.env.SCRAPEBADGER_API_KEY;
  if (!key) {
    throw new Error("ScrapeBadger API key is missing. Set SCRAPEBADGER_API_KEY.");
  }
  return key;
}

function assertQueryLength(query: string): void {
  if (Buffer.byteLength(query, "utf8") > MAX_QUERY_BYTES) {
    throw new Error(
      `Search query is longer than ${MAX_QUERY_BYTES} bytes, which ScrapeBadger rejects.`,
    );
  }
}

/** Collector stores permalinks as Reddit paths and prefixes the host itself. */
function toPermalinkPath(permalink: string): string {
  if (!permalink) return "";
  if (permalink.startsWith("http://") || permalink.startsWith("https://")) {
    try {
      return new URL(permalink).pathname;
    } catch {
      return permalink;
    }
  }
  return permalink.startsWith("/") ? permalink : `/${permalink}`;
}

function toPost(post: ScrapeBadgerPost): RedditPostRaw | null {
  if (!post.id) return null;
  return {
    id: post.id,
    name: post.fullname ?? `t3_${post.id}`,
    title: post.title ?? "",
    selftext: post.selftext ?? "",
    subreddit: post.subreddit ?? "",
    author: post.author ?? "[deleted]",
    score: post.score ?? 0,
    num_comments: post.num_comments ?? 0,
    url: post.url ?? "",
    permalink: toPermalinkPath(post.permalink ?? ""),
    created_utc: Math.floor(post.created_utc ?? 0),
    is_self: post.is_self ?? false,
    link_flair_text: post.link_flair_text ?? undefined,
    raw: post,
  };
}

async function scrapeBadgerGet<T>(
  path: string,
  params: URLSearchParams,
  retryThrottles?: boolean,
): Promise<T> {
  const response = await fetchWithRetry(
    `${apiBase()}${path}?${params}`,
    {
      headers: {
        "X-API-Key": apiKey(),
        Accept: "application/json",
      },
    },
    "ScrapeBadger",
    retryThrottles,
  );

  if (response.status === 401 || response.status === 403) {
    throw new Error("ScrapeBadger rejected the API key. Check SCRAPEBADGER_API_KEY.");
  }

  if (response.status === 402) {
    throw new ProviderWaitError(
      "ScrapeBadger is out of credits. Add credits to your ScrapeBadger account.",
      "no_credits",
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ScrapeBadger request failed: ${response.status} ${detail.slice(0, 180)}`.trim());
  }

  return (await response.json()) as T;
}

/** Splits a subreddit list into groups that each fit in one search. See {@link searchBytes}. */
function subredditBatches(query: string, options: RedditSearchOptions): string[] {
  const batches: string[] = [];
  let current: string[] = [];
  for (const name of subredditNames(options)) {
    const next = [...current, name];
    if (current.length > 0 && searchBytes(query, next) > MAX_QUERY_BYTES) {
      batches.push(current.join("+"));
      current = [name];
    } else {
      current = next;
    }
  }
  if (current.length > 0) batches.push(current.join("+"));
  return batches;
}

async function searchPosts(
  query: string,
  options: RedditSearchOptions,
): Promise<RedditPostRaw[]> {
  assertQueryLength(query);

  const batches = subredditBatches(query, options);
  const groups = batches.length > 0 ? batches : [undefined];
  if (groups.length > 1) {
    console.warn(
      `ScrapeBadger needs ${groups.length} searches to cover ${options.subreddits?.length ?? 0} subreddits.`,
    );
  }

  const seen = new Set<string>();
  const posts: RedditPostRaw[] = [];

  for (const batch of groups) {
    const params = new URLSearchParams({
      q: query,
      sort: options.sort ?? "new",
      t: options.timeframe ?? "week",
      limit: String(Math.min(Math.max(options.limit ?? 100, 1), 100)),
    });
    if (batch) params.set("subreddit", batch);
    if (options.after) params.set("after", options.after);

    const data = await scrapeBadgerGet<{ posts?: ScrapeBadgerPost[] }>(
      "/search/posts",
      params,
      options.retryThrottles,
    );
    for (const post of data.posts ?? []) {
      const mapped = toPost(post);
      if (!mapped || seen.has(mapped.id)) continue;
      seen.add(mapped.id);
      posts.push(mapped);
    }
  }

  return posts;
}

async function searchCommunities(query: string, limit: number): Promise<SubredditInfo[]> {
  assertQueryLength(query);

  const params = new URLSearchParams({
    q: query,
    limit: String(Math.min(Math.max(limit, 1), 100)),
  });

  try {
    const data = await scrapeBadgerGet<{ subreddits?: ScrapeBadgerSubreddit[] }>(
      "/search/subreddits",
      params,
    );

    return (data.subreddits ?? []).flatMap((sub) => {
      if (!sub.name) return [];
      return [{
        name: sub.name,
        subscribers: sub.subscribers ?? 0,
        description: sub.public_description ?? "",
      }];
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("API key")) throw error;
    console.warn(`Subreddit search failed: ${error instanceof Error ? error.message : "Unknown"}`);
    return [];
  }
}

async function getUser(username: string): Promise<RedditAuthorRaw | null> {
  try {
    const data = await scrapeBadgerGet<{ user?: RedditUserPayload }>(
      `/users/${encodeURIComponent(username)}`,
      new URLSearchParams(),
      false,
    );
    return toRedditAuthor(data.user);
  } catch (error) {
    if (error instanceof Error && /failed: 404\b/.test(error.message)) return null;
    throw error;
  }
}

export const scrapeBadger: RedditProvider = {
  id: "scrapebadger",
  searchPosts,
  searchSubreddits: searchCommunities,
  getUser,
};
