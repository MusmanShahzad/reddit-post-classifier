/**
 * Organism Component Tests
 *
 * Tests for complex components composed of atoms and molecules.
 * These tests verify correct composition, data rendering, and interaction flows.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PostCard, type PostData } from "@/components/organisms/PostCard";
import { CategoryBreakdown } from "@/components/organisms/CategoryBreakdown";
import { ActivityLog } from "@/components/organisms/ActivityLog";
import { EmptyState } from "@/components/atoms";

// ---------------------------------------------------------------------------
// PostCard
// ---------------------------------------------------------------------------
describe("PostCard author and opening", () => {
  const post: PostData = {
    id: "1",
    title: "Acme dashboard keeps crashing",
    body: "Crashes daily",
    subreddit: "SaaS",
    permalink: "https://reddit.com/r/SaaS/comments/abc/test",
    redditScore: 1,
    numComments: 1,
    redditCreatedAt: new Date(),
    status: "new",
    urgency: null,
    category: null,
    sentiment: null,
    reason: null,
    author: "sam",
    authorProfile: { displayName: "Sam Lee", iconUrl: "https://i.redd.it/s.png" },
    authorPostCount: 3,
    mentions: { names: [{ value: "Acme", type: "brand" }], people: ["helper"] },
  };
  const handlers = { onHandle: vi.fn(), onDismiss: vi.fn(), onReopen: vi.fn() };

  it("shows the picture, name, username, other posts and mentions", () => {
    const { container } = render(<PostCard post={post} {...handlers} />);
    expect(screen.getByText("Sam Lee")).toBeDefined();
    expect(screen.getByText("u/sam")).toBeDefined();
    expect(screen.getByText("2 other posts")).toBeDefined();
    expect(screen.getByText("Acme")).toBeDefined();
    expect(screen.getByText("u/helper")).toBeDefined();
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://i.redd.it/s.png");
  });

  it("shows the first letter until a profile exists", () => {
    const { container } = render(<PostCard post={{ ...post, authorProfile: null }} {...handlers} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("S")).toBeDefined();
    expect(screen.getByText("u/sam")).toBeDefined();
  });

  it("falls back to the letter when the picture does not load", () => {
    const { container } = render(<PostCard post={post} {...handlers} />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("S")).toBeDefined();
  });

  it("opens when the card is clicked, but not from its buttons", () => {
    const onOpen = vi.fn();
    const onHandle = vi.fn();
    render(<PostCard post={post} {...handlers} onHandle={onHandle} onOpen={onOpen} />);

    fireEvent.click(screen.getByText("Crashes daily"));
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /mark handled/i }));
    expect(onHandle).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("opens once from the title, which keyboard users can reach", () => {
    const onOpen = vi.fn();
    render(<PostCard post={post} {...handlers} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: post.title }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("says when a rate limit has delayed a post", () => {
    render(
      <PostCard
        post={{ ...post, status: "pending", classifyRetryAt: new Date(Date.now() + 60_000) }}
        {...handlers}
      />,
    );
    expect(screen.getByText(/Rate limited, retries at/)).toBeDefined();
  });
});

describe("PostCard", () => {
  const basePost: PostData = {
    id: "1",
    title: "Acme dashboard keeps crashing",
    body: "Every time I load more than 10k rows...",
    subreddit: "SaaS",
    permalink: "https://reddit.com/r/SaaS/comments/abc/test",
    redditScore: 42,
    numComments: 15,
    redditCreatedAt: new Date(Date.now() - 3600000),
    status: "new",
    urgency: 4,
    category: "complaint",
    sentiment: "negative",
    reason: "Active user reporting recurring dashboard crash.",
  };

  const defaultHandlers = {
    onHandle: vi.fn(),
    onDismiss: vi.fn(),
    onReopen: vi.fn(),
  };

  it("renders the post title", () => {
    render(<PostCard post={basePost} {...defaultHandlers} />);
    expect(screen.getByText("Acme dashboard keeps crashing")).toBeInTheDocument();
  });

  it("renders urgency badge", () => {
    render(<PostCard post={basePost} {...defaultHandlers} />);
    expect(screen.getByText(/High/)).toBeInTheDocument();
  });

  it("renders category and sentiment badges", () => {
    render(<PostCard post={basePost} {...defaultHandlers} />);
    expect(screen.getByText(/Complaint/)).toBeInTheDocument();
    expect(screen.getByText(/Negative/)).toBeInTheDocument();
  });

  it("renders the AI reason", () => {
    render(<PostCard post={basePost} {...defaultHandlers} />);
    expect(
      screen.getByText(/Active user reporting recurring dashboard crash/),
    ).toBeInTheDocument();
  });

  it("renders subreddit name", () => {
    render(<PostCard post={basePost} {...defaultHandlers} />);
    expect(screen.getByText("r/SaaS")).toBeInTheDocument();
  });

  it("renders body preview", () => {
    render(<PostCard post={basePost} {...defaultHandlers} />);
    expect(screen.getByText(/Every time I load/)).toBeInTheDocument();
  });

  it("renders Handle and Dismiss for new post", () => {
    render(<PostCard post={basePost} {...defaultHandlers} />);
    expect(screen.getByText("Mark handled")).toBeInTheDocument();
    expect(screen.getByText("Dismiss")).toBeInTheDocument();
  });

  it("renders Reopen for handled post", () => {
    render(
      <PostCard post={{ ...basePost, status: "handled" }} {...defaultHandlers} />,
    );
    expect(screen.getByText("Reopen")).toBeInTheDocument();
  });

  it("does not show urgency or category on a post that failed the filter", () => {
    render(
      <PostCard
        post={{ ...basePost, status: "filtered", reason: null, audienceTag: "potential_customer" }}
        {...defaultHandlers}
      />,
    );
    expect(screen.getByText("Not relevant")).toBeInTheDocument();
    expect(screen.queryByText(/High/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Complaint/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Potential customer/)).not.toBeInTheDocument();
  });

  it("hides urgency badge when urgency is null", () => {
    render(
      <PostCard
        post={{ ...basePost, urgency: null }}
        {...defaultHandlers}
      />,
    );
    expect(screen.queryByText(/High/)).not.toBeInTheDocument();
  });

  it("hides reason when null", () => {
    render(
      <PostCard post={{ ...basePost, reason: null }} {...defaultHandlers} />,
    );
    expect(screen.queryByText("💡")).not.toBeInTheDocument();
  });

  it("calls onHandle when button clicked", () => {
    const onHandle = vi.fn();
    render(<PostCard post={basePost} {...defaultHandlers} onHandle={onHandle} />);
    fireEvent.click(screen.getByText("Mark handled"));
    expect(onHandle).toHaveBeenCalledOnce();
  });

  it("calls onMarkRelevant with the user's reason", () => {
    const onMarkRelevant = vi.fn();
    render(
      <PostCard
        post={{ ...basePost, status: "filtered", reason: null }}
        {...defaultHandlers}
        onMarkRelevant={onMarkRelevant}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("One line on why this post matters"), {
      target: { value: "This customer is asking for the feature we ship." },
    });
    fireEvent.click(screen.getByText("Mark relevant"));
    expect(onMarkRelevant).toHaveBeenCalledWith(
      "This customer is asking for the feature we ship.",
    );
  });
});

// ---------------------------------------------------------------------------
// CategoryBreakdown
// ---------------------------------------------------------------------------
describe("CategoryBreakdown", () => {
  it("renders all categories", () => {
    render(
      <CategoryBreakdown
        totalRelevant={30}
        categories={[
          { category: "complaint", count: 15 },
          { category: "praise", count: 10 },
          { category: "other", count: 5 },
        ]}
      />,
    );
    expect(screen.getByText("Complaint")).toBeInTheDocument();
    expect(screen.getByText("Praise")).toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  it("renders counts", () => {
    render(
      <CategoryBreakdown
        totalRelevant={25}
        categories={[{ category: "complaint", count: 25 }]}
      />,
    );
    expect(screen.getByText("25")).toBeInTheDocument();
  });

  it("shows empty message when no categories", () => {
    render(<CategoryBreakdown totalRelevant={0} categories={[]} />);
    expect(screen.getByText(/No data yet/)).toBeInTheDocument();
  });

  it("renders an icon for known categories", () => {
    const { container } = render(
      <CategoryBreakdown
        totalRelevant={10}
        categories={[{ category: "bug_report", count: 10 }]}
      />,
    );
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ActivityLog
// ---------------------------------------------------------------------------
describe("ActivityLog", () => {
  it("shows live events when collecting", () => {
    render(
      <ActivityLog
        isCollecting={true}
        liveEvents={[
          { type: "started", message: "Collection started for Acme" },
          { type: "fetching", message: 'Searching Reddit: "Acme"' },
        ]}
        activity={[]}
      />,
    );
    expect(screen.getByText("Collection started for Acme")).toBeInTheDocument();
    expect(screen.getByText(/Searching Reddit/)).toBeInTheDocument();
  });

  it("shows live title when collecting", () => {
    render(
      <ActivityLog isCollecting={true} liveEvents={[]} activity={[]} />,
    );
    expect(screen.getByText("Live collection")).toBeInTheDocument();
  });

  it("shows activity title when idle", () => {
    render(
      <ActivityLog isCollecting={false} liveEvents={[]} activity={[]} />,
    );
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
  });

  it("shows activity logs when not collecting", () => {
    render(
      <ActivityLog
        isCollecting={false}
        liveEvents={[]}
        activity={[
          { id: "1", type: "fetch", message: "Fetched 240 posts", timestamp: new Date() },
        ]}
      />,
    );
    expect(screen.getByText("Fetched 240 posts")).toBeInTheDocument();
  });

  it("shows empty message when no activity", () => {
    render(
      <ActivityLog isCollecting={false} liveEvents={[]} activity={[]} />,
    );
    expect(screen.getByText(/No activity yet/)).toBeInTheDocument();
  });

  it("applies error styling to error events", () => {
    render(
      <ActivityLog
        isCollecting={true}
        liveEvents={[{ type: "error", message: "Connection failed" }]}
        activity={[]}
      />,
    );
    expect(screen.getByText("Connection failed").className).toContain("text-error");
  });

  it("groups by run, keeps older runs closed, and offers a Problems filter", () => {
    const at = (minutes: number) => new Date(Date.now() - minutes * 60_000);
    render(
      <ActivityLog
        isCollecting={false}
        liveEvents={[]}
        activity={[
          { id: "1", type: "completed", message: "Collection complete! 3 new posts, 1 kept.", timestamp: at(1), runId: "new", runStatus: "completed" },
          { id: "2", type: "fetched", message: 'Found 7 posts for "Acme" (3 new, 1 duplicates, 3 without the name)', timestamp: at(2), runId: "new", runStatus: "completed" },
          { id: "3", type: "error", message: "Error searching: down", timestamp: at(90), runId: "old", runStatus: "failed" },
        ]}
      />,
    );

    const [newest, older] = screen.getAllByTestId("activity-run") as HTMLDetailsElement[];
    expect(newest?.open).toBe(true);
    expect(older?.open).toBe(false);
    expect(screen.getByText("3 dropped")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Problems/ }));

    expect(screen.queryByText("Found 7 posts")).not.toBeInTheDocument();
    expect(screen.getByText("Error searching: down")).toBeInTheDocument();
  });

  it("offers no filter when nothing went wrong", () => {
    render(
      <ActivityLog
        isCollecting={false}
        liveEvents={[]}
        activity={[{ id: "1", type: "started", message: "Started", timestamp: new Date(), runId: "a" }]}
      />,
    );
    expect(screen.queryByRole("button", { name: /Problems/ })).not.toBeInTheDocument();
  });

  it("offers older runs on request, instead of a very long list", () => {
    render(
      <ActivityLog
        isCollecting={false}
        liveEvents={[]}
        activity={Array.from({ length: 6 }, (_, index) => ({
          id: String(index),
          type: "started",
          message: `Run ${index}`,
          timestamp: new Date(Date.now() - index * 60_000),
          runId: `run-${index}`,
        }))}
      />,
    );
    expect(screen.getAllByTestId("activity-run")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Show 2 older runs" }));
    expect(screen.getAllByTestId("activity-run")).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// EmptyState (used by organisms, tested here for integration)
// ---------------------------------------------------------------------------
describe("EmptyState integration", () => {
  it("renders in the same way organisms would use it", () => {
    render(
      <EmptyState
        title="No posts matching your filters."
        message="Try adjusting the filters or run a new collection."
      />,
    );
    expect(screen.getByText("No posts matching your filters.")).toBeInTheDocument();
    expect(screen.getByText(/Try adjusting/)).toBeInTheDocument();
  });
});
