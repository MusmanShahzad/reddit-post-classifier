/**
 * Official Reddit Data API provider.
 *
 * Uses an approved script app (`REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`)
 * and application-only OAuth. Select it with `REDDIT_PROVIDER=reddit`.
 */

import { env } from "@/env";
import { fetchWithRetry, ProviderWaitError, subredditNames } from "./http";
import {
  toRedditAuthor,
  type RedditAuthorRaw,
  type RedditPostRaw,
  type RedditProvider,
  type RedditSearchOptions,
  type RedditUserPayload,
  type SubredditInfo,
} from "./types";

const USER_AGENT = "Radarr/1.0.0 (Reddit Monitoring Tool)";
const TOKEN_URL = "https://www.reddit.com/api/v1/access_token";
const API_BASE = "https://oauth.reddit.com";

interface RedditToken {
  access_token: string;
  expires_at: number;
}

let cachedToken: RedditToken | null = null;

/** Drops the cached OAuth token. Used by tests. */
export function clearRedditTokenCache(): void {
  cachedToken = null;
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires_at) {
    return cachedToken.access_token;
  }

  if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) {
    throw new Error(
      "Reddit API credentials are missing. Set REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET.",
    );
  }

  const credentials = Buffer.from(
    `${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`,
  ).toString("base64");

  const response = await fetchWithRetry(
    TOKEN_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: "grant_type=client_credentials",
    },
    "Reddit auth",
    false,
  );

  if (!response.ok) {
    throw new Error(`Reddit auth failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000 - 60_000,
  };

  return cachedToken.access_token;
}

async function searchOne(
  query: string,
  options: RedditSearchOptions,
): Promise<RedditPostRaw[]> {
  const token = await getToken();

  const params = new URLSearchParams({
    q: query,
    sort: options.sort ?? "new",
    t: options.timeframe ?? "week",
    limit: String(options.limit ?? 100),
    type: "link",
    raw_json: "1",
  });

  if (options.after) params.set("after", options.after);

  const baseUrl = options.subreddit
    ? `${API_BASE}/r/${options.subreddit}/search.json`
    : `${API_BASE}/search.json`;

  if (options.subreddit) params.set("restrict_sr", "true");

  const response = await fetchWithRetry(
    `${baseUrl}?${params}`,
    { headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT } },
    "Reddit",
    options.retryThrottles,
  );

  if (!response.ok) {
    throw new Error(`Reddit search failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    data: { children: Array<{ data: RedditPostRaw }> };
  };

  return data.data.children.map((child) => ({
    ...child.data,
    raw: child.data,
  }));
}

async function searchPosts(
  query: string,
  options: RedditSearchOptions,
): Promise<RedditPostRaw[]> {
  const names = subredditNames(options);
  if (names.length <= 1) {
    return searchOne(query, { ...options, subreddit: names[0], subreddits: undefined });
  }

  const seen = new Set<string>();
  const posts: RedditPostRaw[] = [];
  for (const name of names) {
    const page = await searchOne(query, { ...options, subreddit: name, subreddits: undefined });
    for (const post of page) {
      if (seen.has(post.id)) continue;
      seen.add(post.id);
      posts.push(post);
    }
  }
  return posts;
}

async function searchCommunities(query: string, limit: number): Promise<SubredditInfo[]> {
  const params = new URLSearchParams({
    q: query,
    limit: String(Math.min(Math.max(limit, 1), 100)),
    sort: "relevance",
    raw_json: "1",
  });

  let response: Response;
  try {
    const token = await getToken();
    response = await fetchWithRetry(
      `${API_BASE}/subreddits/search.json?${params}`,
      { headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT } },
      "Reddit",
    );
  } catch (error) {
    if (!(error instanceof ProviderWaitError)) throw error;
    console.warn(`Subreddit search failed: ${error.message}`);
    return [];
  }

  if (!response.ok) {
    console.warn(`Subreddit search failed: ${response.status}`);
    return [];
  }

  const data = (await response.json()) as {
    data: {
      children: Array<{
        data: { display_name: string; subscribers: number; public_description: string };
      }>;
    };
  };

  return data.data.children.map((child) => ({
    name: child.data.display_name,
    subscribers: child.data.subscribers ?? 0,
    description: child.data.public_description ?? "",
  }));
}

async function getUser(username: string): Promise<RedditAuthorRaw | null> {
  const token = await getToken();
  const response = await fetchWithRetry(
    `${API_BASE}/user/${encodeURIComponent(username)}/about.json?raw_json=1`,
    { headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT } },
    "Reddit",
    false,
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Reddit user lookup failed: ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as { data?: RedditUserPayload };
  return toRedditAuthor(body.data);
}

export const officialReddit: RedditProvider = {
  id: "reddit",
  searchPosts,
  searchSubreddits: searchCommunities,
  getUser,
};
