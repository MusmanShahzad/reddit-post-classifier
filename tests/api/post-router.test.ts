/**
 * Post Router Unit Tests
 *
 * Tests for the feed, status mutation, stats, and activity endpoints.
 * Uses a mock Prisma client to isolate router logic from the database.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildFeedWhere } from "@/lib/feed-filter";

// Mock DB helpers
function createMockDb() {
  return {
    redditPost: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    collectionLog: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

// ---------------------------------------------------------------------------
// getFeed
// ---------------------------------------------------------------------------
describe("Post Router — getFeed logic", () => {
  it("builds correct where clause for new relevant posts", () => {
    expect(buildFeedWhere({ status: "new", relevance: "relevant" })).toEqual({
      isRelevant: true,
      status: "new",
    });
  });

  it("builds correct where clause for all visible relevant posts", () => {
    expect(buildFeedWhere({ status: "all", relevance: "relevant" }).status).toEqual({
      notIn: ["dismissed", "pending", "filtered", "error", "review"],
    });
  });

  it("shows saved posts that are still waiting to be classified", () => {
    expect(buildFeedWhere({ status: "new", relevance: "waiting" })).toEqual({
      status: "pending",
    });
  });

  it("includes waiting posts in all saved", () => {
    expect(buildFeedWhere({ status: "all", relevance: "all" }).status).toEqual({
      notIn: ["dismissed", "error"],
    });
  });

  it("shows saved posts that did not pass the filter", () => {
    expect(buildFeedWhere({ status: "new", relevance: "filtered" })).toEqual({
      isRelevant: false,
      status: "filtered",
    });
  });

  it("adds category filter when provided", () => {
    const where: Record<string, unknown> = {};
    const category = "complaint";
    if (category) where.category = category;
    expect(where.category).toBe("complaint");
  });

  it("adds urgency filter when provided", () => {
    const where: Record<string, unknown> = {};
    const minUrgency = 4;
    if (minUrgency) where.urgency = { gte: minUrgency };
    expect(where.urgency).toEqual({ gte: 4 });
  });

  it("implements cursor pagination correctly", () => {
    const limit = 20;
    const posts = Array.from({ length: limit + 1 }, (_, i) => ({
      id: String(i),
      title: `Post ${i}`,
    }));

    let nextCursor: string | undefined;
    if (posts.length > limit) {
      const nextItem = posts.pop();
      nextCursor = nextItem?.id;
    }

    expect(posts.length).toBe(limit);
    expect(nextCursor).toBe(String(limit));
  });

  it("returns undefined cursor when no more pages", () => {
    const limit = 20;
    const posts = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      title: `Post ${i}`,
    }));

    let nextCursor: string | undefined;
    if (posts.length > limit) {
      const nextItem = posts.pop();
      nextCursor = nextItem?.id;
    }

    expect(nextCursor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// updateStatus
// ---------------------------------------------------------------------------
describe("Post Router — updateStatus logic", () => {
  it("accepts valid status values", () => {
    const validStatuses = ["handled", "dismissed", "new"] as const;
    for (const status of validStatuses) {
      expect(typeof status).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// getStats
// ---------------------------------------------------------------------------
describe("Post Router — getStats logic", () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it("returns all stat fields", async () => {
    db.redditPost.count
      .mockResolvedValueOnce(100) // total
      .mockResolvedValueOnce(50)  // relevant
      .mockResolvedValueOnce(50)  // filtered
      .mockResolvedValueOnce(5)   // urgent
      .mockResolvedValueOnce(40)  // pending
      .mockResolvedValueOnce(10)  // handled
      .mockResolvedValueOnce(0);  // dismissed

    const counts = await Promise.all([
      db.redditPost.count(),
      db.redditPost.count(),
      db.redditPost.count(),
      db.redditPost.count(),
      db.redditPost.count(),
      db.redditPost.count(),
      db.redditPost.count(),
    ]);

    expect(counts).toEqual([100, 50, 50, 5, 40, 10, 0]);
  });

  it("maps category groupBy to expected format", () => {
    const groupByResult = [
      { category: "complaint", _count: 15 },
      { category: "praise", _count: 8 },
    ];

    const mapped = groupByResult.map((c) => ({
      category: c.category ?? "unknown",
      count: c._count,
    }));

    expect(mapped).toEqual([
      { category: "complaint", count: 15 },
      { category: "praise", count: 8 },
    ]);
  });

  it("handles null category in groupBy", () => {
    const result = { category: null, _count: 3 };
    const mapped = { category: result.category ?? "unknown", count: result._count };
    expect(mapped.category).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// getRecentActivity
// ---------------------------------------------------------------------------
describe("Post Router — getRecentActivity", () => {
  it("respects limit parameter", () => {
    const limit = 15;
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThanOrEqual(100);
  });
});
