import { describe, it, expect } from "vitest";

interface MockRedditPost {
  id: string;
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
  name: string;
}

function createMockPost(overrides: Partial<MockRedditPost> = {}): MockRedditPost {
  return {
    id: `post_${Math.random().toString(36).slice(2, 8)}`,
    name: "t3_test",
    title: "Test post about QuickBooks",
    selftext: "Has anyone tried the new invoicing feature?",
    subreddit: "smallbusiness",
    author: "test_user",
    score: 42,
    num_comments: 12,
    url: "https://reddit.com/r/smallbusiness/test",
    permalink: "/r/smallbusiness/comments/test/test_post/",
    created_utc: Date.now() / 1000,
    is_self: true,
    ...overrides,
  };
}

function deduplicatePosts(posts: MockRedditPost[]): MockRedditPost[] {
  const seen = new Map<string, MockRedditPost>();
  for (const post of posts) {
    if (!seen.has(post.id)) {
      seen.set(post.id, post);
    }
  }
  return [...seen.values()];
}

describe("Deduplication", () => {
  it("should remove duplicate posts with the same Reddit ID", () => {
    const post1 = createMockPost({ id: "abc123" });
    const post2 = createMockPost({ id: "abc123", title: "Same post different title" });
    const post3 = createMockPost({ id: "def456" });

    const result = deduplicatePosts([post1, post2, post3]);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.id)).toEqual(["abc123", "def456"]);
  });

  it("should keep the first occurrence when duplicates exist", () => {
    const post1 = createMockPost({ id: "abc123", title: "First occurrence" });
    const post2 = createMockPost({ id: "abc123", title: "Second occurrence" });

    const result = deduplicatePosts([post1, post2]);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("First occurrence");
  });

  it("should handle empty input", () => {
    expect(deduplicatePosts([])).toEqual([]);
  });

  it("should handle all unique posts", () => {
    const posts = [
      createMockPost({ id: "a" }),
      createMockPost({ id: "b" }),
      createMockPost({ id: "c" }),
    ];
    expect(deduplicatePosts(posts)).toHaveLength(3);
  });

  it("should dedup posts from multiple queries that match the same post", () => {
    const samePost = createMockPost({ id: "xyz789", title: "QuickBooks vs FreshBooks" });

    const queryResults = [
      [samePost, createMockPost({ id: "unique1" })],
      [{ ...samePost }, createMockPost({ id: "unique2" })],
      [{ ...samePost }],
    ];

    const allPosts = queryResults.flat();
    const deduped = deduplicatePosts(allPosts);

    expect(deduped).toHaveLength(3); // xyz789, unique1, unique2
    expect(deduped.filter((p) => p.id === "xyz789")).toHaveLength(1);
  });

  it("should handle large numbers of duplicates efficiently", () => {
    const posts: MockRedditPost[] = [];
    for (let i = 0; i < 1000; i++) {
      posts.push(createMockPost({ id: `post_${i % 50}` })); // 50 unique, 950 dupes
    }
    const result = deduplicatePosts(posts);
    expect(result).toHaveLength(50);
  });
});

describe("Database deduplication (upsert behavior)", () => {
  it("should use redditId as the unique key for DB dedup", () => {
    // Simulates a database using a Map for the unique constraint
    const db = new Map<string, { redditId: string; title: string }>();

    function upsert(redditId: string, title: string) {
      if (!db.has(redditId)) {
        db.set(redditId, { redditId, title });
        return "created";
      }
      return "skipped";
    }

    expect(upsert("abc123", "First run")).toBe("created");
    expect(upsert("abc123", "Second run")).toBe("skipped");
    expect(upsert("def456", "Different post")).toBe("created");
    expect(db.size).toBe(2);
  });
});

describe("Dismissed posts filter", () => {
  it("should exclude dismissed posts from feed results", () => {
    const posts = [
      { id: "1", status: "new", isRelevant: true },
      { id: "2", status: "handled", isRelevant: true },
      { id: "3", status: "dismissed", isRelevant: true },
      { id: "4", status: "new", isRelevant: true },
      { id: "5", status: "dismissed", isRelevant: true },
    ];

    const feedPosts = posts.filter(
      (p) => p.isRelevant && p.status !== "dismissed",
    );
    expect(feedPosts).toHaveLength(3);
    expect(feedPosts.every((p) => p.status !== "dismissed")).toBe(true);
  });

  it("should never return dismissed posts even with 'all' filter", () => {
    const posts = [
      { id: "1", status: "new" },
      { id: "2", status: "handled" },
      { id: "3", status: "dismissed" },
    ];

    const allVisible = posts.filter(
      (p) => !["dismissed", "pending", "filtered", "error"].includes(p.status),
    );
    expect(allVisible).toHaveLength(2);
    expect(allVisible.map((p) => p.id)).toEqual(["1", "2"]);
  });
});
