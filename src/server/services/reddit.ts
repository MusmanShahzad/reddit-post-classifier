import { env } from "~/env";

interface RedditToken {
  access_token: string;
  expires_at: number;
}

interface RedditSearchOptions {
  sort?: "relevance" | "new" | "hot" | "top" | "comments";
  timeframe?: "hour" | "day" | "week" | "month" | "year" | "all";
  limit?: number;
  subreddit?: string;
  after?: string;
}

export interface RedditPostRaw {
  id: string;
  name: string;
  title: string;
  selftext: string;
  subreddit: string;
  author: string;
  score: number;
  num_comments: number;
  url: string;
  permalink: string;
  created_utc: number;
  is_self: boolean;
  link_flair_text?: string;
}

let cachedToken: RedditToken | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires_at) {
    return cachedToken.access_token;
  }

  const credentials = Buffer.from(
    `${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`,
  ).toString("base64");

  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Radarr/1.0.0 (Reddit Monitoring Tool)",
    },
    body: "grant_type=client_credentials",
  });

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function searchReddit(
  query: string,
  options: RedditSearchOptions = {},
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

  if (options.after) {
    params.set("after", options.after);
  }

  const baseUrl = options.subreddit
    ? `https://oauth.reddit.com/r/${options.subreddit}/search.json`
    : "https://oauth.reddit.com/search.json";

  if (options.subreddit) {
    params.set("restrict_sr", "true");
  }

  const response = await fetch(`${baseUrl}?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "Radarr/1.0.0 (Reddit Monitoring Tool)",
    },
  });

  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    const waitMs = (Number(retryAfter) || 60) * 1000;
    console.warn(`Reddit rate limited. Waiting ${waitMs}ms...`);
    await sleep(waitMs);
    return searchReddit(query, options);
  }

  if (!response.ok) {
    throw new Error(`Reddit search failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    data: {
      children: Array<{ data: RedditPostRaw }>;
      after: string | null;
    };
  };

  return data.data.children.map((child) => child.data);
}

export async function searchSubreddits(
  query: string,
  limit = 10,
): Promise<Array<{ name: string; subscribers: number; description: string }>> {
  const token = await getToken();

  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    sort: "relevance",
  });

  const response = await fetch(
    `https://oauth.reddit.com/subreddits/search.json?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "Radarr/1.0.0 (Reddit Monitoring Tool)",
      },
    },
  );

  if (!response.ok) {
    console.warn(`Subreddit search failed: ${response.status}`);
    return [];
  }

  const data = (await response.json()) as {
    data: {
      children: Array<{
        data: {
          display_name: string;
          subscribers: number;
          public_description: string;
        };
      }>;
    };
  };

  return data.data.children
    .map((child) => ({
      name: child.data.display_name,
      subscribers: child.data.subscribers,
      description: child.data.public_description,
    }))
    .filter((s) => s.subscribers > 5000)
    .sort((a, b) => b.subscribers - a.subscribers);
}

export function buildSearchQueries(
  keywords: Array<{ type: string; value: string; aliases: string[] }>,
): string[] {
  const queries: string[] = [];

  for (const kw of keywords) {
    if (kw.type === "brand") {
      queries.push(`"${kw.value}"`);
      if (kw.aliases.length > 0) {
        queries.push(kw.aliases.map((a) => `"${a}"`).join(" OR "));
      }
      queries.push(`"${kw.value}" (issue OR problem OR bug OR broken OR error)`);
      queries.push(`"${kw.value}" (love OR amazing OR recommend OR great OR best)`);
    } else if (kw.type === "competitor") {
      queries.push(`"${kw.value}"`);
      queries.push(`"${kw.value}" vs`);
    } else if (kw.type === "topic") {
      queries.push(kw.value);
    }
  }

  return [...new Set(queries)];
}
