import { describe, it, expect } from "vitest";
import { buildSearchQueries } from "~/server/services/reddit";

describe("Search Query Generation", () => {
  it("should generate exact match queries for brand keywords", () => {
    const queries = buildSearchQueries([
      { type: "brand", value: "QuickBooks", aliases: [] },
    ]);
    expect(queries).toContain('"QuickBooks"');
  });

  it("should generate alias queries for brand keywords", () => {
    const queries = buildSearchQueries([
      { type: "brand", value: "QuickBooks", aliases: ["QB", "QBO"] },
    ]);
    expect(queries.some((q) => q.includes('"QB"') && q.includes('"QBO"'))).toBe(
      true,
    );
  });

  it("should generate complaint and praise pattern queries for brands", () => {
    const queries = buildSearchQueries([
      { type: "brand", value: "QuickBooks", aliases: [] },
    ]);
    expect(
      queries.some(
        (q) => q.includes('"QuickBooks"') && q.includes("issue OR problem"),
      ),
    ).toBe(true);
    expect(
      queries.some(
        (q) => q.includes('"QuickBooks"') && q.includes("love OR amazing"),
      ),
    ).toBe(true);
  });

  it("should generate comparison queries for competitors", () => {
    const queries = buildSearchQueries([
      { type: "competitor", value: "FreshBooks", aliases: [] },
    ]);
    expect(queries).toContain('"FreshBooks"');
    expect(queries).toContain('"FreshBooks" vs');
  });

  it("should use topic keywords as-is", () => {
    const queries = buildSearchQueries([
      {
        type: "topic",
        value: "best accounting software for freelancers",
        aliases: [],
      },
    ]);
    expect(queries).toContain("best accounting software for freelancers");
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

    expect(queries.length).toBeGreaterThanOrEqual(6);
    expect(queries).toContain('"QuickBooks"');
    expect(queries).toContain('"FreshBooks"');
    expect(queries).toContain("invoicing software small business");
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
    expect(queries.length).toBeGreaterThan(0);
    expect(queries).toContain('"Notion"');
  });
});
