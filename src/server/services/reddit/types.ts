/**
 * Shared contract for every Reddit source.
 *
 * The collector and onboarding call {@link searchPosts} and
 * {@link searchSubreddits}. A new source implements {@link RedditProvider}
 * and is registered in `index.ts`. Switching sources is the `REDDIT_PROVIDER`
 * environment variable.
 */

export const REDDIT_PROVIDERS = ["scrapebadger", "reddit"] as const;

export type RedditProviderId = (typeof REDDIT_PROVIDERS)[number];

/** Options for a post search. Every provider receives this same shape. */
export interface RedditSearchOptions {
  /** Sort order. @default "new" */
  sort?: "relevance" | "new" | "hot" | "top" | "comments";
  /** Time window for results. @default "week" */
  timeframe?: "hour" | "day" | "week" | "month" | "year" | "all";
  /** Max results per request (1–100). @default 100 */
  limit?: number;
  /** Restrict to one subreddit. Omit to search all of Reddit. */
  subreddit?: string;
  /**
   * Restrict to several subreddits in as few requests as the provider allows.
   * ScrapeBadger sends them in one search.
   */
  subreddits?: string[];
  /** Opaque cursor from a previous page. */
  after?: string;
  /**
   * Wait and try again in place when throttled. The search queue turns this off
   * because it does its own waiting. @default true
   */
  retryThrottles?: boolean;
}

/** Post shape the rest of Radarr stores. Providers map their payloads into this. */
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
  /** Query string that found this post. */
  matchedQuery?: string;
  /** Complete provider payload, kept so storage can persist every field. */
  raw?: unknown;
}

/** A Reddit user's public profile. */
export interface RedditAuthorRaw {
  username: string;
  fullname: string | null;
  displayName: string | null;
  linkKarma: number | null;
  commentKarma: number | null;
  awardeeKarma: number | null;
  awarderKarma: number | null;
  totalKarma: number | null;
  createdUtc: number | null;
  isGold: boolean | null;
  isEmployee: boolean | null;
  isMod: boolean | null;
  verified: boolean | null;
  hasVerifiedEmail: boolean | null;
  iconUrl: string | null;
  raw: unknown;
}

/** The profile fields both providers return under the same names. */
export interface RedditUserPayload {
  id?: string;
  name?: string;
  link_karma?: number;
  comment_karma?: number;
  awardee_karma?: number;
  awarder_karma?: number;
  total_karma?: number;
  created_utc?: number;
  is_gold?: boolean;
  is_employee?: boolean;
  is_mod?: boolean;
  verified?: boolean;
  has_verified_email?: boolean;
  icon_img?: string | null;
  snoovatar_img?: string | null;
  subreddit?: { title?: string | null } | null;
}

/** Maps a profile payload. Returns `null` when it has no username. */
export function toRedditAuthor(user: RedditUserPayload | undefined): RedditAuthorRaw | null {
  if (!user?.name) return null;
  // Reddit escapes the ampersands in its image links.
  const icon = user.snoovatar_img || user.icon_img;
  return {
    username: user.name,
    fullname: user.id ? `t2_${user.id.replace(/^t2_/, "")}` : null,
    displayName: user.subreddit?.title?.trim() || null,
    linkKarma: user.link_karma ?? null,
    commentKarma: user.comment_karma ?? null,
    awardeeKarma: user.awardee_karma ?? null,
    awarderKarma: user.awarder_karma ?? null,
    totalKarma: user.total_karma ?? null,
    createdUtc: user.created_utc ?? null,
    isGold: user.is_gold ?? null,
    isEmployee: user.is_employee ?? null,
    isMod: user.is_mod ?? null,
    verified: user.verified ?? null,
    hasVerifiedEmail: user.has_verified_email ?? null,
    iconUrl: icon ? icon.replaceAll("&amp;", "&") : null,
    raw: user,
  };
}

/** Subreddit shape used by onboarding suggestions. */
export interface SubredditInfo {
  name: string;
  subscribers: number;
  description: string;
}

/**
 * One Reddit source. Add a file next to the existing providers and register
 * it in `index.ts` to make it selectable.
 */
export interface RedditProvider {
  id: RedditProviderId;
  searchPosts(query: string, options: RedditSearchOptions): Promise<RedditPostRaw[]>;
  searchSubreddits(query: string, limit: number): Promise<SubredditInfo[]>;
  /** One user's profile, or `null` when the user does not exist. */
  getUser(username: string): Promise<RedditAuthorRaw | null>;
}
