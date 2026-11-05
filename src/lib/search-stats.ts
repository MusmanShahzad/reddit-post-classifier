/**
 * Rolls search-queue rows into per-query and per-keyword totals.
 * A tag is strong when at least one in five new posts is relevant.
 */

/**
 * - `not_run`: no finished or failed search yet.
 * - `failed`: every run of this search errored. Edit or remove it.
 * - `empty`: the search worked and found no posts.
 * - `early`: posts found, but too few classified to judge.
 * - `weak` / `mixed` / `strong`: share of new posts that were relevant.
 */
export type SearchVerdict = "strong" | "weak" | "mixed" | "early" | "empty" | "failed" | "not_run";

/** Classified posts needed before a tag with no relevant posts is called weak. */
export const MIN_SAMPLE = 5;

export interface SearchRow {
  query: string;
  status: string;
  fetchedCount: number;
  newCount: number;
  duplicateCount: number;
  relevantCount: number;
  filteredCount: number;
  error?: string | null;
}

export interface SearchTally {
  query: string;
  done: number;
  failed: number;
  skipped: number;
  pending: number;
  fetched: number;
  fresh: number;
  duplicates: number;
  relevant: number;
  filtered: number;
  lastError: string | null;
  verdict: SearchVerdict;
}

export function verdictFor(
  tally: Pick<SearchTally, "done" | "failed" | "fetched" | "fresh" | "relevant" | "filtered">,
): SearchVerdict {
  if (tally.done === 0 && tally.failed === 0) return "not_run";
  if (tally.done === 0) return "failed";
  if (tally.fetched === 0) return "empty";
  if (tally.relevant === 0) {
    return tally.relevant + tally.filtered < MIN_SAMPLE ? "early" : "weak";
  }
  if (tally.relevant / Math.max(tally.fresh, 1) >= 0.2) return "strong";
  return "mixed";
}

/** Runs in a row with nothing useful before a search is paused. */
export const WEAK_RUNS_BEFORE_PAUSE = 2;
/** Runs a paused search sits out before it is tried again. */
export const RUNS_TO_SIT_OUT = 3;

/**
 * Searches to leave out of the next run to save credits, from their past rows,
 * newest first. A search is paused after finding nothing useful in consecutive
 * runs, and it gets another try after sitting out a few runs, so a subject that
 * becomes active again is still picked up.
 */
export function pausedSearches(
  history: Array<Pick<SearchRow, "query" | "status" | "relevantCount">>,
): Set<string> {
  const byQuery = new Map<string, typeof history>();
  for (const row of history) {
    byQuery.set(row.query, [...(byQuery.get(row.query) ?? []), row]);
  }

  const paused = new Set<string>();
  for (const [query, rows] of byQuery) {
    const satOut = rows.findIndex((row) => row.status !== "skipped");
    if (satOut === -1 || satOut >= RUNS_TO_SIT_OUT) continue;

    const recent = rows.slice(satOut).filter((row) => row.status === "done").slice(0, WEAK_RUNS_BEFORE_PAUSE);
    if (recent.length === WEAK_RUNS_BEFORE_PAUSE && recent.every((row) => row.relevantCount === 0)) {
      paused.add(query);
    }
  }
  return paused;
}

export interface TaggedPost {
  matchedQuery: string | null;
  isRelevant: boolean | null;
}

/**
 * One tally row per search, counted from the posts it saved.
 * Used when a run stored posts and then stopped before it wrote search rows.
 */
export function rowsFromTaggedPosts(posts: TaggedPost[]): SearchRow[] {
  const byQuery = new Map<string, SearchRow>();

  for (const post of posts) {
    if (!post.matchedQuery) continue;
    const row = byQuery.get(post.matchedQuery) ?? {
      query: post.matchedQuery,
      status: "done",
      fetchedCount: 0,
      newCount: 0,
      duplicateCount: 0,
      relevantCount: 0,
      filteredCount: 0,
    };
    row.fetchedCount += 1;
    row.newCount += 1;
    if (post.isRelevant === true) row.relevantCount += 1;
    else if (post.isRelevant === false) row.filteredCount += 1;
    byQuery.set(post.matchedQuery, row);
  }

  return [...byQuery.values()];
}

/**
 * Posts a search returned that were not kept: they never use the tracked name,
 * or in rare cases could not be saved. Fetched = new + duplicates + dropped.
 */
export function droppedPosts(row: { fetchedCount: number; newCount: number; duplicateCount: number }): number {
  return Math.max(0, row.fetchedCount - row.newCount - row.duplicateCount);
}

export function foldSearchRows(rows: SearchRow[]): SearchTally[] {
  const byQuery = new Map<string, SearchTally>();

  for (const row of rows) {
    const tally = byQuery.get(row.query) ?? {
      query: row.query,
      done: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
      fetched: 0,
      fresh: 0,
      duplicates: 0,
      relevant: 0,
      filtered: 0,
      lastError: null,
      verdict: "not_run" as const,
    };

    if (row.status === "done") tally.done += 1;
    else if (row.status === "failed") tally.failed += 1;
    else if (row.status === "skipped") tally.skipped += 1;
    else tally.pending += 1;

    tally.fetched += row.fetchedCount;
    tally.fresh += row.newCount;
    tally.duplicates += row.duplicateCount;
    tally.relevant += row.relevantCount;
    tally.filtered += row.filteredCount;
    if (row.error) tally.lastError = row.error;
    byQuery.set(row.query, tally);
  }

  return [...byQuery.values()].map((tally) => ({ ...tally, verdict: verdictFor(tally) }));
}

export function keywordMatchesQuery(query: string, value: string, aliases: string[] = []): boolean {
  return [value, ...aliases].some((term) => {
    const needle = term.trim();
    if (needle.length === 0) return false;
    // Whole words only, so the keyword "car" does not claim the query "scary movies".
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`, "i");
    return pattern.test(query);
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function tallyForKeyword(value: string, aliases: string[], queries: SearchTally[]): SearchTally {
  const matched = queries.filter((query) => keywordMatchesQuery(query.query, value, aliases));
  const combined = matched.reduce<SearchTally>(
    (sum, query) => ({
      query: value,
      done: sum.done + query.done,
      failed: sum.failed + query.failed,
      skipped: sum.skipped + query.skipped,
      pending: sum.pending + query.pending,
      fetched: sum.fetched + query.fetched,
      fresh: sum.fresh + query.fresh,
      duplicates: sum.duplicates + query.duplicates,
      relevant: sum.relevant + query.relevant,
      filtered: sum.filtered + query.filtered,
      lastError: query.lastError ?? sum.lastError,
      verdict: "not_run",
    }),
    {
      query: value,
      done: 0,
      failed: 0,
      skipped: 0,
      pending: 0,
      fetched: 0,
      fresh: 0,
      duplicates: 0,
      relevant: 0,
      filtered: 0,
      lastError: null,
      verdict: "not_run",
    },
  );
  return { ...combined, verdict: verdictFor(combined) };
}
