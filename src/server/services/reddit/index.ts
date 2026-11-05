/**
 * Reddit source used by the collector and onboarding.
 *
 * Callers keep using {@link searchReddit} and {@link searchSubreddits}.
 * The active source comes from `REDDIT_PROVIDER`:
 *
 * - `scrapebadger` — ScrapeBadger (default)
 * - `reddit` — official Reddit Data API
 *
 * To add a source, implement {@link RedditProvider} and register it in
 * `providers` below. No collector changes are required.
 *
 * @module services/reddit
 */

import { env } from "@/env";
import { filterSubredditsByTopic } from "./queries";
import { officialReddit } from "./official";
import { scrapeBadger } from "./scrapebadger";
import type { RedditProvider, RedditProviderId, RedditSearchOptions } from "./types";

const providers: Record<RedditProviderId, RedditProvider> = {
  scrapebadger: scrapeBadger,
  reddit: officialReddit,
};

let activeId: RedditProviderId = env.REDDIT_PROVIDER;

/** Points later searches at another registered source. */
export function useRedditProvider(id: RedditProviderId): void {
  if (!providers[id]) {
    throw new Error(`Unknown Reddit provider "${id}". Use ${Object.keys(providers).join(" or ")}.`);
  }
  activeId = id;
}

/** The source currently serving searches. */
export function getRedditProvider(): RedditProvider {
  return providers[activeId];
}

/**
 * Searches public posts through the active provider.
 *
 * @param query - Search query (quotes mark an exact match).
 * @param options - Sort, timeframe, limit, subreddit, and pagination cursor.
 */
export async function searchReddit(
  query: string,
  options: RedditSearchOptions = {},
) {
  return getRedditProvider().searchPosts(query, options);
}

/**
 * Searches subreddits through the active provider, then keeps communities
 * with more than 5,000 subscribers whose description matches the topic.
 */
export async function searchSubreddits(query: string, limit = 10) {
  const fetched = await getRedditProvider().searchSubreddits(
    query,
    Math.min(limit * 3, 100),
  );

  return filterSubredditsByTopic(
    query,
    fetched.filter((sub) => sub.subscribers > 5000),
  )
    .sort((a, b) => b.subscribers - a.subscribers)
    .slice(0, limit);
}

/** One user's profile through the active provider, or `null` when the user does not exist. */
export async function getRedditUser(username: string) {
  return getRedditProvider().getUser(username);
}

export { clearRedditTokenCache } from "./official";
export {
  buildSearchQueries,
  filterSubredditsByTopic,
  isSubredditSearch,
  queriesForCollection,
  subredditsForOneSearch,
  subredditQueries,
  topicWords,
  withoutBuyingWords,
} from "./queries";
export type { RedditPostRaw, RedditProvider, RedditProviderId, SubredditInfo } from "./types";
