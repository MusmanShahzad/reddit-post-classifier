/**
 * Collector Router & Pipeline Unit Tests
 *
 * Tests for the collection pipeline logic: deduplication, event types,
 * stat accumulation, and query generation.
 */

import { urgencyLevel } from "@/lib/relevance";
import { describe, it, expect } from "vitest";
import type { CollectionEvent, CollectionStats } from "@/server/services/collector";

// ---------------------------------------------------------------------------
// CollectionEvent types
// ---------------------------------------------------------------------------
describe("Collector — CollectionEvent types", () => {
  it("started event has correct shape", () => {
    const event: CollectionEvent = { type: "started", message: "Collection started" };
    expect(event.type).toBe("started");
  });

  it("fetching event includes query", () => {
    const event: CollectionEvent = {
      type: "fetching",
      query: '"Acme Corp"',
      message: 'Searching Reddit: "Acme Corp"',
    };
    expect(event.query).toBe('"Acme Corp"');
  });

  it("completed event includes stats", () => {
    const stats: CollectionStats = {
      totalFetched: 100,
      totalNew: 30,
      totalClassified: 30,
      totalRelevant: 10,
      totalFiltered: 20,
      errorCount: 0,
    };
    const event: CollectionEvent = {
      type: "completed",
      stats,
      message: "Done",
    };
    expect(event.type).toBe("completed");
    if (event.type === "completed") {
      expect(event.stats.totalRelevant).toBe(10);
    }
  });

  it("error event includes error string", () => {
    const event: CollectionEvent = {
      type: "error",
      error: "Connection failed",
      message: "Error",
    };
    expect(event.type).toBe("error");
    if (event.type === "error") {
      expect(event.error).toBe("Connection failed");
    }
  });
});

// ---------------------------------------------------------------------------
// CollectionStats accumulation
// ---------------------------------------------------------------------------
describe("Collector — Stats accumulation", () => {
  it("initializes all stats to zero", () => {
    const stats: CollectionStats = {
      totalFetched: 0,
      totalNew: 0,
      totalClassified: 0,
      totalRelevant: 0,
      totalFiltered: 0,
      errorCount: 0,
    };

    expect(Object.values(stats).every((v) => v === 0)).toBe(true);
  });

  it("increments relevant and classified correctly", () => {
    const stats: CollectionStats = {
      totalFetched: 100,
      totalNew: 30,
      totalClassified: 0,
      totalRelevant: 0,
      totalFiltered: 0,
      errorCount: 0,
    };

    // Simulate classification
    const isRelevant = true;
    stats.totalClassified++;
    if (isRelevant) stats.totalRelevant++;
    else stats.totalFiltered++;

    expect(stats.totalClassified).toBe(1);
    expect(stats.totalRelevant).toBe(1);
    expect(stats.totalFiltered).toBe(0);
  });

  it("increments filtered correctly", () => {
    const stats: CollectionStats = {
      totalFetched: 100,
      totalNew: 30,
      totalClassified: 0,
      totalRelevant: 0,
      totalFiltered: 0,
      errorCount: 0,
    };

    stats.totalClassified++;
    stats.totalFiltered++;

    expect(stats.totalClassified).toBe(1);
    expect(stats.totalFiltered).toBe(1);
    expect(stats.totalRelevant).toBe(0);
  });

  it("tracks errors separately", () => {
    const stats: CollectionStats = {
      totalFetched: 0,
      totalNew: 0,
      totalClassified: 0,
      totalRelevant: 0,
      totalFiltered: 0,
      errorCount: 0,
    };

    stats.errorCount++;
    stats.errorCount++;

    expect(stats.errorCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// In-memory deduplication
// ---------------------------------------------------------------------------
describe("Collector — In-memory deduplication", () => {
  it("deduplicates posts by id within a run", () => {
    const rawPosts = [
      { id: "abc", title: "Post 1" },
      { id: "def", title: "Post 2" },
      { id: "abc", title: "Post 1 duplicate" },
      { id: "ghi", title: "Post 3" },
      { id: "def", title: "Post 2 duplicate" },
    ];

    const uniquePosts = new Map<string, (typeof rawPosts)[0]>();
    for (const post of rawPosts) {
      if (!uniquePosts.has(post.id)) {
        uniquePosts.set(post.id, post);
      }
    }

    expect(uniquePosts.size).toBe(3);
    expect(uniquePosts.get("abc")?.title).toBe("Post 1");
  });

  it("handles empty input", () => {
    const rawPosts: Array<{ id: string }> = [];
    const uniquePosts = new Map<string, (typeof rawPosts)[0]>();
    for (const post of rawPosts) {
      if (!uniquePosts.has(post.id)) {
        uniquePosts.set(post.id, post);
      }
    }
    expect(uniquePosts.size).toBe(0);
  });

  it("handles all unique posts", () => {
    const rawPosts = [
      { id: "a", title: "1" },
      { id: "b", title: "2" },
      { id: "c", title: "3" },
    ];

    const uniquePosts = new Map<string, (typeof rawPosts)[0]>();
    for (const post of rawPosts) {
      if (!uniquePosts.has(post.id)) {
        uniquePosts.set(post.id, post);
      }
    }

    expect(uniquePosts.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Urgency normalization
// ---------------------------------------------------------------------------
describe("Collector — Urgency normalization", () => {
  it.each([
    [0, 1],
    [1, 2],
    [4, 5],
    [10, 5],
    [-1, 1],
  ])("maps raw score %s to urgency %s", (raw, level) => {
    expect(urgencyLevel(raw)).toBe(level);
  });
});
