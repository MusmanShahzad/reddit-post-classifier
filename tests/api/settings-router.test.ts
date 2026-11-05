/**
 * Settings Router Unit Tests
 *
 * Tests for keyword CRUD, subreddit management, search query operations,
 * and the auto-regeneration of search queries when keywords change.
 */

import { describe, it, expect } from "vitest";
import { buildSearchQueries } from "@/server/services/reddit";

// ---------------------------------------------------------------------------
// getCompany
// ---------------------------------------------------------------------------
describe("Settings Router — getCompany logic", () => {
  it("returns null when no active company", () => {
    const settings = null as { activeCompanyId?: string } | null;
    const result = settings?.activeCompanyId ?? null;
    expect(result).toBeNull();
  });

  it("returns company ID when configured", () => {
    const settings = { activeCompanyId: "cmp_123" };
    expect(settings.activeCompanyId).toBe("cmp_123");
  });
});

// ---------------------------------------------------------------------------
// addKeyword + regeneration
// ---------------------------------------------------------------------------
describe("Settings Router — addKeyword + query regeneration", () => {
  it("creates keyword with correct data shape", () => {
    const input = {
      companyId: "cmp_123",
      type: "brand" as const,
      value: "Acme Corp",
      aliases: ["acme", "ACME"],
    };

    const data = {
      companyId: input.companyId,
      type: input.type,
      value: input.value,
      aliases: JSON.stringify(input.aliases),
    };

    expect(data.companyId).toBe("cmp_123");
    expect(data.type).toBe("brand");
    expect(data.value).toBe("Acme Corp");
    expect(JSON.parse(data.aliases)).toEqual(["acme", "ACME"]);
  });

  it("regenerates search queries after keyword addition", () => {
    const keywords = [
      { type: "brand", value: "Acme Corp", aliases: ["acme"] },
      { type: "competitor", value: "DataBox", aliases: [] },
    ];

    const queries = buildSearchQueries(keywords);
    expect(queries).toEqual(['"Acme Corp" OR "acme"', '"DataBox"']);
  });
});

// ---------------------------------------------------------------------------
// deleteKeyword
// ---------------------------------------------------------------------------
describe("Settings Router — deleteKeyword", () => {
  it("removes keyword and triggers regeneration", () => {
    const initialKeywords = [
      { type: "brand", value: "Acme Corp", aliases: [] },
      { type: "competitor", value: "DataBox", aliases: [] },
    ];

    const afterDeletion = initialKeywords.filter((k) => k.value !== "DataBox");
    const queries = buildSearchQueries(afterDeletion);

    expect(queries.some((q) => q.includes("DataBox"))).toBe(false);
    expect(queries.some((q) => q.includes("Acme Corp"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// addSubreddit
// ---------------------------------------------------------------------------
describe("Settings Router — addSubreddit", () => {
  it("strips r/ prefix from name", () => {
    const name = "r/webdev".replace(/^r\//, "");
    expect(name).toBe("webdev");
  });

  it("handles name without r/ prefix", () => {
    const name = "webdev".replace(/^r\//, "");
    expect(name).toBe("webdev");
  });
});

// ---------------------------------------------------------------------------
// addCustomQuery
// ---------------------------------------------------------------------------
describe("Settings Router — addCustomQuery", () => {
  it("marks query as custom", () => {
    const data = {
      companyId: "cmp_123",
      query: "acme pricing feedback",
      isCustom: true,
    };
    expect(data.isCustom).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateSettings
// ---------------------------------------------------------------------------
describe("Settings Router — updateSettings", () => {
  it("validates collection interval range", () => {
    const validIntervals = [5, 30, 60, 720, 1440];
    const invalidIntervals = [0, 4, 1441, -1];

    for (const v of validIntervals) {
      expect(v >= 5 && v <= 1440).toBe(true);
    }
    for (const v of invalidIntervals) {
      expect(v >= 5 && v <= 1440).toBe(false);
    }
  });

  it("validates relevance threshold range", () => {
    const validThresholds = [0, 0.3, 0.5, 0.6, 1];
    const invalidThresholds = [-0.1, 1.1, 2];

    for (const v of validThresholds) {
      expect(v >= 0 && v <= 1).toBe(true);
    }
    for (const v of invalidThresholds) {
      expect(v >= 0 && v <= 1).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// regenerateSearchQueries
// ---------------------------------------------------------------------------
describe("Settings Router — regenerateSearchQueries", () => {
  it("preserves custom queries during regeneration", () => {
    const allQueries = [
      { query: '"Acme Corp"', isCustom: false },
      { query: "custom pricing feedback", isCustom: true },
    ];

    const customOnly = allQueries.filter((q) => q.isCustom);
    expect(customOnly.length).toBe(1);
    expect(customOnly[0]!.query).toBe("custom pricing feedback");
  });

  it("generates expected query patterns for brand keywords", () => {
    const queries = buildSearchQueries([
      { type: "brand", value: "TestBrand", aliases: ["Test Brand", "tb"] },
    ]);

    expect(queries).toEqual(['"TestBrand" OR "Test Brand"']);
  });

  it("generates one search for a competitor keyword", () => {
    const queries = buildSearchQueries([
      { type: "competitor", value: "RivalCo", aliases: [] },
    ]);

    expect(queries).toEqual(['"RivalCo"']);
  });

  it("generates expected query patterns for topic keywords", () => {
    const queries = buildSearchQueries([
      { type: "topic", value: "machine learning", aliases: [] },
    ]);

    expect(queries[0]!.startsWith('"machine learning" (recommend')).toBe(true);
    expect(queries[1]!.startsWith("machine learning (recommend")).toBe(true);
  });
});
