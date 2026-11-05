import { describe, expect, it } from "vitest";
import { matchingKeywords, trackedKeyword } from "@/lib/post-tags";
import { foldSearchRows, keywordMatchesQuery, pausedSearches, rowsFromTaggedPosts, tallyForKeyword, verdictFor } from "@/lib/search-stats";

describe("pausedSearches", () => {
  const row = (status: string, relevantCount = 0) => ({ query: "q", status, relevantCount });

  it("pauses a search after two runs with nothing useful", () => {
    expect(pausedSearches([row("done"), row("done")]).has("q")).toBe(true);
  });

  it("gives a search two chances before pausing it", () => {
    expect(pausedSearches([row("done")]).has("q")).toBe(false);
  });

  it("keeps a search that found something in either recent run", () => {
    expect(pausedSearches([row("done"), row("done", 2)]).has("q")).toBe(false);
    expect(pausedSearches([row("done", 1), row("done")]).has("q")).toBe(false);
  });

  it("does not count a failed search as finding nothing", () => {
    expect(pausedSearches([row("failed"), row("done")]).has("q")).toBe(false);
  });

  it("stays paused while sitting out, then tries again", () => {
    const weak = [row("done"), row("done")];
    expect(pausedSearches([row("skipped"), row("skipped"), ...weak]).has("q")).toBe(true);
    expect(pausedSearches([row("skipped"), row("skipped"), row("skipped"), ...weak]).has("q")).toBe(false);
  });

  it("pauses again if the retry also finds nothing", () => {
    const history = [row("done"), row("skipped"), row("skipped"), row("skipped"), row("done"), row("done")];
    expect(pausedSearches(history).has("q")).toBe(true);
  });

  it("does not pause a search that has only ever been left out", () => {
    expect(pausedSearches([row("skipped"), row("skipped")]).has("q")).toBe(false);
  });
});

const base = { done: 1, failed: 0, fetched: 10, fresh: 10, relevant: 0, filtered: 0 };

describe("verdicts", () => {
  it("calls a tag weak when enough posts were checked and none are relevant", () => {
    expect(verdictFor({ ...base, done: 2, relevant: 0, filtered: 10 })).toBe("weak");
  });

  it("does not call a tag weak from a tiny sample", () => {
    expect(verdictFor({ ...base, relevant: 0, filtered: 3 })).toBe("early");
  });

  it("calls a tag with unclassified posts early, not weak", () => {
    expect(verdictFor({ ...base, relevant: 0, filtered: 0 })).toBe("early");
  });

  it("calls a tag strong when at least one in five new posts is relevant", () => {
    expect(verdictFor({ ...base, relevant: 2, filtered: 8 })).toBe("strong");
  });

  it("calls a tag mixed when relevant posts are rare", () => {
    expect(verdictFor({ ...base, fresh: 40, fetched: 40, relevant: 2, filtered: 38 })).toBe("mixed");
  });

  it("keeps a tag as not run until a search finishes or fails", () => {
    expect(verdictFor({ ...base, done: 0, fetched: 0, fresh: 0 })).toBe("not_run");
  });

  it("flags a tag whose every attempt failed", () => {
    expect(verdictFor({ ...base, done: 0, failed: 2, fetched: 0, fresh: 0 })).toBe("failed");
  });

  it("separates a search that found nothing from a weak one", () => {
    expect(verdictFor({ ...base, fetched: 0, fresh: 0 })).toBe("empty");
  });
});

describe("folding rows", () => {
  it("folds several runs of the same search into one row", () => {
    const [tally] = foldSearchRows([
      {
        query: '"Acme"',
        status: "done",
        fetchedCount: 8,
        newCount: 5,
        duplicateCount: 3,
        relevantCount: 2,
        filteredCount: 3,
      },
      {
        query: '"Acme"',
        status: "skipped",
        fetchedCount: 0,
        newCount: 0,
        duplicateCount: 0,
        relevantCount: 0,
        filteredCount: 0,
      },
    ]);

    expect(tally).toMatchObject({
      query: '"Acme"',
      done: 1,
      skipped: 1,
      fetched: 8,
      fresh: 5,
      duplicates: 3,
      relevant: 2,
      verdict: "strong",
    });
  });
});

describe("keyword attribution", () => {
  it("attributes a search to a keyword by name or alias", () => {
    expect(
      keywordMatchesQuery('"Auto Leap" OR "autoleap"', "AutoLeap", ["Auto Leap", "autoleap"]),
    ).toBe(true);
  });

  it("matches whole words only", () => {
    expect(keywordMatchesQuery("scary movies", "car")).toBe(false);
    expect(keywordMatchesQuery('"car service" near me', "car")).toBe(true);
  });

  it("does not break on regex characters in a keyword", () => {
    expect(keywordMatchesQuery("c++ (issue OR problem)", "c++")).toBe(true);
    expect(keywordMatchesQuery("anything", "(")).toBe(false);
  });

  it("ignores an empty keyword or alias", () => {
    expect(keywordMatchesQuery("anything", "  ", [""])).toBe(false);
  });

  it("counts saved posts for a search that never wrote a queue row", () => {
    const [row] = rowsFromTaggedPosts([
      { matchedQuery: "shop management", isRelevant: true },
      { matchedQuery: "shop management", isRelevant: false },
      { matchedQuery: "shop management", isRelevant: null },
      { matchedQuery: null, isRelevant: null },
    ]);
    expect(row).toMatchObject({
      query: "shop management",
      fetchedCount: 3,
      relevantCount: 1,
      filteredCount: 1,
    });
  });

  it("tags a post with the keyword its search names", () => {
    const keywords = [
      { id: "1", value: "Shopmonkey", aliases: "[]" },
      { id: "2", value: "AutoLeap", aliases: '["Auto Leap","autoleap"]' },
      { id: "3", value: "car service", aliases: "[]" },
    ];
    expect(matchingKeywords('"Shopmonkey"', keywords).map((keyword) => keyword.value)).toEqual([
      "Shopmonkey",
    ]);
    expect(trackedKeyword('"AutoLeap"', keywords, "AutoLeap")).toBe("AutoLeap");
    expect(trackedKeyword("scary movies", keywords, "AutoLeap")).toBe("scary movies");
  });

  it("rolls a keyword up from its matching searches", () => {
    const queries = foldSearchRows([
      {
        query: '"Shopmonkey"',
        status: "done",
        fetchedCount: 10,
        newCount: 10,
        duplicateCount: 0,
        relevantCount: 0,
        filteredCount: 10,
      },
    ]);
    expect(tallyForKeyword("Shopmonkey", [], queries).verdict).toBe("weak");
  });
});
