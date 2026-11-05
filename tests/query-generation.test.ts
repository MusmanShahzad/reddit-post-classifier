import { describe, it, expect } from "vitest";
import {
  buildSearchQueries,
  isSubredditSearch,
  queriesForCollection,
  subredditsForOneSearch,
  withoutBuyingWords,
} from "@/server/services/reddit";

const BUYING = " (recommend OR recommendation OR alternative OR alternatives OR switch OR switching OR best OR which OR looking)";

describe("withoutBuyingWords", () => {
  it("removes the buying words and the brackets they needed", () => {
    expect(withoutBuyingWords(`("a b" OR "c d")${BUYING}`)).toBe('"a b" OR "c d"');
    expect(withoutBuyingWords(`((a b) OR (c d))${BUYING}`)).toBe("(a b) OR (c d)");
    expect(withoutBuyingWords(`"a b"${BUYING}`)).toBe('"a b"');
  });

  it("leaves any other search alone", () => {
    expect(withoutBuyingWords('"Acme" OR "Acme Co"')).toBe('"Acme" OR "Acme Co"');
    expect(withoutBuyingWords('(a OR b) (hand written)')).toBe("(a OR b) (hand written)");
  });
});

describe("Search Query Generation", () => {
  it("should generate exact match queries for brand keywords", () => {
    const queries = buildSearchQueries([
      { type: "brand", value: "QuickBooks", aliases: [] },
    ]);
    expect(queries).toContain('"QuickBooks"');
  });

  it("puts brand aliases in the same search", () => {
    const queries = buildSearchQueries([
      { type: "brand", value: "QuickBooks", aliases: ["QB Online", "Intuit QB"] },
    ]);
    expect(queries).toEqual(['"QuickBooks" OR "QB Online" OR "Intuit QB"']);
  });

  it("does not add extra complaint, praise, or comparison searches", () => {
    const queries = buildSearchQueries([
      { type: "brand", value: "QuickBooks", aliases: [] },
      { type: "competitor", value: "FreshBooks", aliases: [] },
    ]);
    expect(queries).toEqual(['"QuickBooks"', '"FreshBooks"']);
  });

  it("marks only loose searches as subreddit searches", () => {
    expect(isSubredditSearch("(wall art) OR (area rug)")).toBe(true);
    expect(isSubredditSearch('"wall art" OR "area rug"')).toBe(false);
    expect(isSubredditSearch('"Acme"')).toBe(false);
  });

  it("keeps a subreddit list to what fits in one paid search", () => {
    const query = "q".repeat(200);
    const kept = subredditsForOneSearch(query, ["aaaaaaaaaa", "bbbbbbbbbb", "cccccccccc", "dddddddddd"]);
    expect(kept).toEqual(["aaaaaaaaaa", "bbbbbbbbbb"]);
    expect(subredditsForOneSearch("q".repeat(250), ["only"])).toEqual(["only"]);
  });

  it("leaves a long topic as written", () => {
    const queries = buildSearchQueries([
      {
        type: "topic",
        value: "best accounting software for busy freelancers",
        aliases: [],
      },
    ]);
    expect(queries).toEqual(["best accounting software for busy freelancers"]);
  });

  it("should generate queries for a complete keyword set", () => {
    const queries = buildSearchQueries([
      { type: "brand", value: "QuickBooks", aliases: ["QB"] },
      { type: "competitor", value: "FreshBooks", aliases: [] },
      {
        type: "topic",
        value: "invoicing software small business",
        aliases: [],
      },
    ]);

    expect(queries).toEqual([
      '"QuickBooks"',
      '"FreshBooks"',
      `"invoicing software small business"${BUYING}`,
      `invoicing software small business${BUYING}`,
    ]);
  });

  it("keeps a real setup to five searches, covering subreddits and all of Reddit", () => {
    const queries = buildSearchQueries([
      { type: "brand", value: "AutoLeap", aliases: ["Auto Leap"] },
      { type: "competitor", value: "Shopmonkey", aliases: ["shop monkey"] },
      { type: "competitor", value: "Tekmetric", aliases: [] },
      { type: "competitor", value: "Mitchell 1", aliases: ["Mitchell1"] },
      { type: "topic", value: "auto repair shop software", aliases: [] },
      { type: "topic", value: "auto shop management software", aliases: [] },
    ]);

    expect(queries).toEqual([
      '"AutoLeap" OR "Auto Leap"',
      '"Shopmonkey" OR "shop monkey" OR "Tekmetric"',
      '("Mitchell 1" OR "Mitchell1") ("auto repair shop" OR "auto shop management")',
      `("auto repair shop software" OR "auto shop management software")${BUYING}`,
      `((auto repair shop software) OR (auto shop management software))${BUYING}`,
    ]);
  });

  it("adds the niche only to names that are also everyday words", () => {
    const queries = buildSearchQueries([
      { type: "brand", value: "Article", aliases: [], ambiguous: true },
      { type: "competitor", value: "West Elm", aliases: [] },
      { type: "competitor", value: "CB2", aliases: [] },
      { type: "topic", value: "wall art", aliases: [] },
      { type: "topic", value: "floor mirror review", aliases: [] },
      { type: "topic", value: "area rug", aliases: [] },
    ]);

    expect(queries).toEqual([
      '"Article" ("wall art" OR "floor mirror" OR "area rug")',
      '"West Elm" OR "CB2"',
      `("wall art" OR "floor mirror review" OR "area rug")${BUYING}`,
      `((wall art) OR (floor mirror review) OR (area rug))${BUYING}`,
    ]);
  });

  it("skips topics made only of broad words", () => {
    const queries = buildSearchQueries([
      { type: "brand", value: "AutoLeap", aliases: [] },
      { type: "topic", value: "customer reviews", aliases: [] },
      { type: "topic", value: "shop management", aliases: [] },
      { type: "topic", value: "mechanic software", aliases: [] },
    ]);

    expect(queries).toEqual(['"AutoLeap"', `"mechanic software"${BUYING}`, `mechanic software${BUYING}`]);
  });

  it("keeps a broad topic when nothing else could be searched", () => {
    expect(
      buildSearchQueries([{ type: "topic", value: "customer reviews", aliases: [] }]),
    ).toEqual([`"customer reviews"${BUYING}`, `customer reviews${BUYING}`]);
  });

  describe("what the session is looking for decides the searches", () => {
    const keywords = [
      { type: "brand", value: "QuickBooks", aliases: ["Quick Books", "QB"] },
      { type: "competitor", value: "Xero", aliases: [] },
      { type: "competitor", value: "FreshBooks", aliases: [] },
      { type: "topic", value: "accounting software", aliases: [] },
    ];

    it("reviews of its own product: one search, for the brand in a title or its own subreddit", () => {
      expect(buildSearchQueries(keywords, ["own_feedback"])).toEqual([
        'title:"QuickBooks" OR title:"Quick Books" OR subreddit:QuickBooks',
      ]);
    });

    it("a two-word brand joins its name for the subreddit", () => {
      expect(buildSearchQueries([{ type: "brand", value: "West Elm", aliases: [] }], ["own_feedback"])).toEqual([
        'title:"West Elm" OR subreddit:WestElm',
      ]);
    });

    it("never searches a very short alias such as QB", () => {
      const all = buildSearchQueries(keywords).join(" ");
      expect(all).not.toContain('"QB"');
    });

    it("competitor feedback: the brand search is plain and competitors are searched", () => {
      const queries = buildSearchQueries(keywords, ["competitor_feedback"]);
      expect(queries).toEqual(['"QuickBooks" OR "Quick Books"', 'title:"Xero" OR title:"FreshBooks"']);
    });

    it("potential clients: competitors with switching words, and topics with buying words", () => {
      const queries = buildSearchQueries(keywords, ["potential_clients"]);

      expect(queries[0]).toBe('"QuickBooks" OR "Quick Books"');
      expect(queries[1]!.startsWith('("Xero" OR "FreshBooks") (alternative OR')).toBe(true);
      expect(queries[2]).toBe(`"accounting software"${BUYING}`);
      expect(queries[3]).toBe(`accounting software${BUYING}`);
      expect(isSubredditSearch(queries[3]!)).toBe(true);
    });

    it("still searches something when the goal has no matching keywords", () => {
      const queries = buildSearchQueries([{ type: "topic", value: "accounting software", aliases: [] }], ["own_feedback"]);
      expect(queries.length).toBeGreaterThan(0);
    });
  });

  it("starts a new search rather than exceed the length limit", () => {
    const long = (letter: string) => letter.repeat(120);
    const queries = buildSearchQueries([
      { type: "competitor", value: long("a"), aliases: [] },
      { type: "competitor", value: long("b"), aliases: [] },
      { type: "competitor", value: long("c"), aliases: [] },
    ]);

    expect(queries).toHaveLength(2);
    expect(queries.every((query) => query.length <= 256)).toBe(true);
    expect(queries.join(" ")).toContain(long("c"));
  });

  it("does not repeat a spelling that differs only by case", () => {
    expect(
      buildSearchQueries([{ type: "brand", value: "AutoLeap", aliases: ["autoleap", "Auto Leap"] }]),
    ).toEqual(['"AutoLeap" OR "Auto Leap"']);
  });

  it("leaves a topic with its own quotes or operators alone", () => {
    expect(
      buildSearchQueries([{ type: "topic", value: '"wall art" OR mirror', aliases: [] }]),
    ).toEqual(['"wall art" OR mirror']);
  });

  it("leaves the name search unchanged when the niche would make it too long", () => {
    const prefix = '"QuickBooks" OR "';
    const alias = "A".repeat(250 - prefix.length - 1);
    const queries = buildSearchQueries([
      { type: "brand", value: "QuickBooks", aliases: [alias], ambiguous: true },
      { type: "topic", value: "invoicing", aliases: [] },
    ]);

    expect(queries[0]).toBe(`${prefix}${alias}"`);
    expect(queries[1]).toBe(`"invoicing"${BUYING}`);
    expect(queries[2]).toBe(`invoicing${BUYING}`);
  });

  it("should deduplicate identical queries", () => {
    const queries = buildSearchQueries([
      { type: "brand", value: "QuickBooks", aliases: ["QuickBooks"] }, // alias same as brand
    ]);

    const uniqueQueries = [...new Set(queries)];
    expect(queries.length).toBe(uniqueQueries.length);
  });

  it("should handle empty keyword list", () => {
    const queries = buildSearchQueries([]);
    expect(queries).toEqual([]);
  });

  it("should handle keywords with empty aliases", () => {
    const queries = buildSearchQueries([
      { type: "brand", value: "Notion", aliases: [] },
    ]);
    expect(queries).toEqual(['"Notion"']);
  });
});

describe("queriesForCollection", () => {
  it("drops stored complaint, praise, and vs searches when the plain query exists", () => {
    const { selected, omitted } = queriesForCollection([
      { query: '"Acme"', isCustom: false },
      { query: '"Acme" (issue OR problem OR bug OR broken OR error)', isCustom: false },
      { query: '"Acme" (love OR amazing OR recommend OR great OR best)', isCustom: false },
      { query: '"Rival" vs', isCustom: false },
      { query: "custom pricing feedback", isCustom: true },
    ]);

    expect(selected).toEqual(['"Acme"', "custom pricing feedback"]);
    expect(omitted).toHaveLength(3);
  });

  it("stops at 12 searches", () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      query: `topic ${index}`,
      isCustom: false,
    }));
    const { selected, omitted } = queriesForCollection(rows);
    expect(selected).toHaveLength(12);
    expect(omitted).toHaveLength(8);
  });
});
