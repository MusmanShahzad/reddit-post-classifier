import { GOALS, type Goal } from "@/lib/goals";
import { isSearchableAlias } from "@/lib/post-tags";
import { monitoringScope } from "@/lib/relevance";

/** Added to a competitor when only its unhappy customers are wanted. */
const SWITCHING_WORDS =
  " (alternative OR alternatives OR switch OR switching OR leaving OR expensive OR hate OR problem)";
/** Added to a topic when only people choosing a product are wanted. No quotes, so it also works in a subreddit search. */
const BUYING_WORDS =
  " (recommend OR recommendation OR alternative OR alternatives OR switch OR switching OR best OR which OR looking)";

/**
 * The same search without its buying words. Used when widening the time window:
 * over a year, "pharmacy delivery" on its own found more on-topic posts than it
 * did with the buying words, which also matched unrelated advice threads.
 */
export function withoutBuyingWords(query: string): string {
  if (!query.endsWith(BUYING_WORDS)) return query;
  const base = query.slice(0, -BUYING_WORDS.length);
  return base.startsWith("(") && base.endsWith(")") ? base.slice(1, -1) : base;
}

/** Common words that should never decide whether a subreddit matches a topic. */
const TOPIC_STOPWORDS = new Set([
  "about", "with", "your", "from", "that", "this", "their", "more", "best",
  "tool", "tools", "app", "apps", "software", "company", "business", "product",
]);

/**
 * Words that describe a mood or a request, not the niche.
 * They stay out of the name search so "QuickBooks problem" does not require
 * the post to contain "problem".
 */
const NICHE_STOPWORDS = new Set([
  ...TOPIC_STOPWORDS,
  "small", "large", "good", "cheap", "free", "online", "review", "reviews",
  "issue", "issues", "problem", "problems", "looking", "anyone", "need",
  "help", "alternative", "alternatives", "versus", "recommend", "using",
  "used", "want", "where", "what", "when", "like", "really", "just",
]);

/**
 * Extracts the meaningful words from a topic phrase.
 *
 * Words shorter than 3 characters and generic stopwords are dropped, so
 * `"auto repair software"` becomes `["auto", "repair"]` and `"car"` stays `["car"]`.
 */
export function topicWords(topic: string): string[] {
  return topic
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !TOPIC_STOPWORDS.has(w));
}

/**
 * Searches for finding communities, in the order to try them. The first joins
 * the leading topics, which is what finds the most fitting communities. The
 * rest are shorter fallbacks that search the trade words of one topic.
 */
export function subredditQueries(topics: string[]): string[] {
  const clean = topics.map((topic) => topic.trim()).filter(Boolean);
  const joined = clean.slice(0, 3).join(" ").slice(0, 200);
  const fallbacks = clean.map((topic) => topicWords(topic).slice(0, 3).join(" ")).filter(Boolean);
  return [...new Set([joined, ...fallbacks].filter(Boolean))].slice(0, 3);
}

/**
 * Keeps only subreddits whose public description contains a topic word as a
 * whole word (plural `s`/`es` allowed), or whose name exactly equals a topic word.
 *
 * Subreddit search can return name lookalikes such as `r/cardano` for "car".
 * Whole-word matching against the description removes those ("career" does
 * not match "car").
 *
 * If the topic has no usable words, every subreddit is kept unchanged.
 */
export function filterSubredditsByTopic<
  T extends { name: string; description: string },
>(topic: string, subs: T[]): T[] {
  const words = topicWords(topic);
  if (words.length === 0) return subs;

  const patterns = words.map((w) => new RegExp(`\\b${w}(s|es)?\\b`, "i"));

  return subs.filter((sub) => {
    if (words.includes(sub.name.toLowerCase())) return true;
    return patterns.some((pattern) => pattern.test(sub.description));
  });
}

/** ScrapeBadger rejects queries longer than this. One search is one credit charge. */
export const MAX_QUERY_BYTES = 256;

/**
 * Hard cap on searches in a single collection run.
 * ScrapeBadger charges 8 credits per search that returns posts, so 12 searches
 * is at most 96 credits. A search that returns nothing costs nothing.
 */
export const MAX_COLLECTION_SEARCHES = 12;

/** Credits ScrapeBadger charges for a search that returns posts. Used for the cost estimate in Settings. */
export const CREDITS_PER_SEARCH = 8;
/** Credits ScrapeBadger charges for one author profile, as its `X-Credits-Used` header reports. */
export const CREDITS_PER_LOOKUP = 5;

/** Generated extras that repeat the same keyword and cost another search each. */
const EXTRA_SEARCH = /\(issue OR problem|\(love OR amazing|\svs$/i;

function fits(query: string): boolean {
  return Buffer.byteLength(query, "utf8") <= MAX_QUERY_BYTES;
}

/**
 * Up to three short niche phrases taken from the topic searches.
 *
 * A topic such as "standing desk review" becomes "standing desk". These
 * phrases are added to the company and competitor searches, so a post has to
 * mention the name and the niche.
 */
export function nicheTerms(topics: string[]): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();

  for (const topic of topics) {
    const words = topic
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3 && !NICHE_STOPWORDS.has(word));
    if (words.length === 0) continue;

    const phrase = words.slice(0, 3).join(" ");
    if (seen.has(phrase)) continue;
    seen.add(phrase);
    terms.push(phrase);
    if (terms.length >= 3) break;
  }

  return terms;
}

/** `standing desk` becomes `"standing desk"`. A single word stays bare. */
function nicheClause(terms: string[]): string {
  if (terms.length === 0) return "";
  const parts = terms.map((term) => (term.includes(" ") ? `"${term}"` : term));
  return ` (${parts.join(" OR ")})`;
}

/** Joins terms with OR, starting a new search when one would be too long. */
function joinWithOr(pieces: string[]): string[] {
  const queries: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (!fits(piece)) continue;
    const next = current ? `${current} OR ${piece}` : piece;
    if (fits(next)) {
      current = next;
    } else {
      queries.push(current);
      current = piece;
    }
  }
  if (current) queries.push(current);
  return queries;
}

/**
 * A name that also means something else in everyday posts. A trailing number
 * counts: "Mitchell 1" matched basketball box scores for the player Mitchell.
 */
function needsNiche(keyword: { value: string; ambiguous?: boolean }): boolean {
  return keyword.ambiguous === true || /\s\d+$/.test(keyword.value.trim());
}

function quotedNames(keyword: { value: string; aliases: string[] }): string[] {
  const names = [keyword.value, ...keyword.aliases.filter(isSearchableAlias)]
    .map((name) => name.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return names
    .filter((name) => {
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((name) => `"${name}"`);
}

/**
 * Finds posts that are about a name rather than posts that merely mention it.
 * In a live test, requiring the name in the title returned real complaints,
 * while the name plus opinion words anywhere returned passing mentions.
 */
function titlePieces(keyword: { value: string; aliases: string[] }): string[] {
  return quotedNames(keyword).map((name) => `title:${name}`);
}

/** The company's own community, when its name can be one. */
function ownSubreddit(name: string): string[] {
  const joined = name.replace(/[^a-z0-9]/gi, "");
  return joined.length >= 3 ? [`subreddit:${joined}`] : [];
}

/** A short phrase can be searched exactly. A long or hand-written one is left alone. */
function isShortPhrase(topic: string): boolean {
  return topic.split(/\s+/).length <= 4 && !/["()]|\bOR\b/.test(topic);
}

/**
 * True for a search meant to run inside the chosen subreddits. It has no
 * quotes, because a community already narrows the subject, so the words can be
 * loose. Quoted searches and names run across all of Reddit.
 */
export function isSubredditSearch(query: string): boolean {
  return !query.includes('"');
}

/**
 * As few searches as possible, because each one is paid for and returns only a
 * handful of posts. What the session looks for decides which searches exist and
 * what words they carry:
 *
 * - **Own feedback only:** the brand in a title or in its own subreddit.
 *   Competitors and topics are not searched, because they are not about the brand.
 * - **Competitor feedback:** all distinctive competitors share one search, in titles
 *   when that is the only goal.
 * - **Potential clients:** the brand by name, competitors with switching words,
 *   and topics with buying words, once across Reddit as exact phrases and once
 *   in the subreddits as loose words.
 *
 * A name that is also an everyday word gets its own search with the niche:
 * `"Article" ("wall art" OR mirror)`. Topics made only of broad words, such as
 * "customer reviews", are not searched while another search exists.
 */
export function buildSearchQueries(
  keywords: Array<{ type: string; value: string; aliases: string[]; ambiguous?: boolean }>,
  goals: readonly Goal[] = GOALS,
): string[] {
  const wantsOwn = goals.includes("own_feedback");
  const wantsRivals = goals.includes("competitor_feedback");
  const wantsClients = goals.includes("potential_clients");
  const named = keywords.filter(
    (keyword) => (keyword.type === "brand" || keyword.type === "competitor") && keyword.value.trim(),
  );
  const topics = keywords.filter((keyword) => keyword.type === "topic" && keyword.value.trim());
  const niche = nicheClause(nicheTerms(topics.map((keyword) => keyword.value)));
  const scope = monitoringScope(keywords);
  const broad = new Set(scope.broadTopics);
  const hasSpecificSearch =
    scope.brands.length + scope.competitors.length + scope.definingTopics.length > 0;

  const queries: string[] = [];

  // Any mention of the brand can be a lead, so only a feedback-only session asks for the title.
  const feedbackOnly = wantsOwn && !wantsClients;
  for (const keyword of named.filter((item) => item.type === "brand")) {
    if (needsNiche(keyword)) {
      queries.push(...joinWithOr(quotedNames(keyword)).map((query) => narrow(query, niche)));
    } else if (feedbackOnly) {
      queries.push(...joinWithOr([...titlePieces(keyword), ...ownSubreddit(keyword.value)]));
    } else {
      queries.push(...joinWithOr(quotedNames(keyword)));
    }
  }

  if (wantsRivals || wantsClients) {
    const rivals = named.filter((item) => item.type === "competitor");
    const distinctive = rivals.filter((item) => !needsNiche(item));
    queries.push(
      ...(wantsRivals && !wantsClients
        ? joinWithOr(distinctive.flatMap(titlePieces))
        : joinWithOr(distinctive.flatMap(quotedNames)).map((query) =>
            narrow(query, wantsRivals ? "" : SWITCHING_WORDS),
          )),
    );
    for (const keyword of rivals.filter(needsNiche)) {
      queries.push(...joinWithOr(quotedNames(keyword)).map((query) => narrow(query, niche)));
    }
  }

  // Topics find people who name nobody, so they serve potential clients only.
  if (wantsClients || queries.length === 0) {
    const searched = topics
      .map((keyword) => keyword.value.trim())
      .filter((topic) => !(hasSpecificSearch && broad.has(topic)));
    const phrases = searched.filter(isShortPhrase);
    queries.push(...joinWithOr(phrases.map((topic) => `"${topic}"`)).map((query) => narrow(query, BUYING_WORDS)));
    queries.push(...searched.filter((topic) => !isShortPhrase(topic) && fits(topic)));

    const loose = phrases.slice(0, 3);
    if (loose.length > 0) {
      const query = loose.length === 1 ? loose[0]! : loose.map((topic) => `(${topic})`).join(" OR ");
      if (fits(query)) queries.push(narrow(query, BUYING_WORDS));
    }
  }

  return [...new Set(queries)];
}

/** Requires the name and the niche, and skips the niche when it would not fit. */
function narrow(nameQuery: string, niche: string): string {
  if (!niche) return nameQuery;
  const grouped = nameQuery.includes(" OR ") ? `(${nameQuery})` : nameQuery;
  const combined = `${grouped}${niche}`;
  return fits(combined) ? combined : nameQuery;
}

/**
 * The bytes a search uses. With several subreddits the provider expands it into
 * `q (subreddit:a OR subreddit:b ...)`, and each name costs 14 bytes plus its
 * own length.
 */
export function searchBytes(query: string, subreddits: string[]): number {
  const bytes = (value: string) => Buffer.byteLength(value, "utf8");
  return bytes(query) + 1 + subreddits.reduce((sum, name) => sum + 14 + bytes(name), 0);
}

/**
 * The subreddits that fit in one search. Reddit reads only the first 256 bytes,
 * and a list that does not fit would be split into more paid searches. The list
 * is kept in its order, so the first subreddits are the ones searched.
 */
export function subredditsForOneSearch(query: string, subreddits: string[]): string[] {
  const kept: string[] = [];
  for (const name of subreddits) {
    if (kept.length > 0 && searchBytes(query, [...kept, name]) > MAX_QUERY_BYTES) break;
    kept.push(name);
  }
  return kept;
}

/**
 * Picks the searches a collection run should actually pay for.
 *
 * Drops stored complaint, praise, and "vs" variants when a plain keyword
 * search is already in the list, keeps custom queries, and stops at
 * {@link MAX_COLLECTION_SEARCHES}.
 */
export function queriesForCollection(
  rows: Array<{ query: string; isCustom: boolean }>,
): { selected: string[]; omitted: string[] } {
  const unique = new Map<string, boolean>();
  for (const row of rows) {
    const query = row.query.trim();
    if (!query) continue;
    unique.set(query, (unique.get(query) ?? false) || row.isCustom);
  }

  const entries = [...unique.entries()];
  const lean = entries.filter(([query, isCustom]) => isCustom || !EXTRA_SEARCH.test(query));
  const pool = (lean.length > 0 ? lean : entries).map(([query]) => query);
  const selected = pool.slice(0, MAX_COLLECTION_SEARCHES);
  const selectedSet = new Set(selected);
  const omitted = entries.map(([query]) => query).filter((query) => !selectedSet.has(query));

  return { selected, omitted };
}
