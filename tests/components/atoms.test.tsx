/**
 * Atom Component Tests
 *
 * Tests for the smallest, most reusable UI components. Each atom is tested
 * for correct rendering, prop handling, and basic interactions.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  AnimatedNumber,
  AnimatedText,
  Logo,
  StatCard,
  UrgencyBadge,
  CategoryBadge,
  SentimentBadge,
  LoadingSpinner,
  ThinkingTrace,
  RemovableTag,
  EmptyState,
  StatCardSkeleton,
  PostCardSkeleton,
  CategoryBreakdownSkeleton,
  CollectionStatusSkeleton,
  ActivityLogSkeleton,
  KeywordSectionSkeleton,
  SubredditSectionSkeleton,
  SearchQuerySectionSkeleton,
  AppLoadingSkeleton,
  DashboardSkeleton,
  FeedSkeleton,
  SettingsSkeleton,
} from "@/components/atoms";

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------
describe("Logo", () => {
  it("renders the R letter", () => {
    render(<Logo />);
    expect(screen.getByText("R")).toBeInTheDocument();
  });

  it("applies the correct size class for sm", () => {
    render(<Logo size="sm" />);
    const el = screen.getByText("R");
    expect(el.className).toContain("h-8");
  });

  it("applies the correct size class for lg", () => {
    render(<Logo size="lg" />);
    const el = screen.getByText("R");
    expect(el.className).toContain("h-12");
  });

  it("has an aria-label", () => {
    render(<Logo />);
    expect(screen.getByLabelText("Radarr logo")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------
describe("StatCard", () => {
  it("renders label and value", () => {
    render(<StatCard label="Total Posts" value={42} icon="📊" />);
    expect(screen.getByText("Total Posts")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders the icon", () => {
    render(<StatCard label="Urgent" value={7} icon="🔴" />);
    expect(screen.getByText("🔴")).toBeInTheDocument();
  });

  it("renders the value in a stat", () => {
    render(<StatCard label="Relevant" value={10} icon="✅" />);
    expect(screen.getByText("10").closest(".stat-value")).not.toBeNull();
  });
});

describe("AnimatedNumber", () => {
  it("shows the value at once on first render", () => {
    render(<AnimatedNumber value={42} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("reaches the new value, on the same element", async () => {
    const { rerender } = render(<AnimatedNumber value={0} suffix="%" />);
    const element = screen.getByText("0%");
    rerender(<AnimatedNumber value={80} suffix="%" />);
    await waitFor(() => expect(element).toHaveTextContent("80%"), { timeout: 4000 });
  });
});

describe("AnimatedText", () => {
  it("stays still until the text changes, then fades in the new text", () => {
    const { rerender } = render(<AnimatedText text="running" />);
    expect(screen.getByText("running").className).not.toContain("animate-text-change");

    rerender(<AnimatedText text="running" />);
    expect(screen.getByText("running").className).not.toContain("animate-text-change");

    rerender(<AnimatedText text="completed" />);
    expect(screen.getByText("completed").className).toContain("animate-text-change");
  });
});

describe("ThinkingTrace", () => {
  const steps = [
    { id: "moderation", label: "Safety check", status: "done" as const, detail: "Passed" },
    { id: "extraction", label: "Understanding your answers", status: "running" as const },
    { id: "guardrails", label: "Business check", status: "pending" as const },
  ];

  it("shows the current action while running, with the steps open", () => {
    const activity = [
      { stepId: "moderation", text: "Checking the message is safe" },
      { stepId: "extraction", text: "They sell: desks" },
    ];
    render(<ThinkingTrace steps={steps} activity={activity} running />);
    expect(screen.getByRole("button", { expanded: true })).toHaveTextContent("They sell: desks");
    expect(screen.getByText("Safety check")).toBeInTheDocument();
    expect(screen.queryByText("Business check")).not.toBeInTheDocument();
  });

  it("lists each line under the step it came from", () => {
    const activity = [{ stepId: "moderation", text: "Checking the message is safe" }];
    render(<ThinkingTrace steps={steps} activity={activity} running={false} durationMs={1000} />);
    const safety = screen.getByText("Safety check").closest("li");
    expect(safety).toHaveTextContent("Checking the message is safe");
  });

  it("says it is writing once the reply starts", () => {
    render(<ThinkingTrace steps={steps} activity={[{ text: "Reading your message" }]} running writing />);
    expect(screen.getByRole("button")).toHaveTextContent("Writing the reply");
  });

  it("folds into a summary when done, and opens on click", () => {
    const done = steps.map((s) => ({ ...s, status: "done" as const }));
    render(<ThinkingTrace steps={done} running={false} durationMs={3400} />);
    const toggle = screen.getByRole("button", { expanded: false });
    expect(toggle).toHaveTextContent("Worked for 3s");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
  });

  it("names the step that stopped the turn", () => {
    const stopped = [{ id: "guardrails", label: "Business check", status: "error" as const }];
    render(<ThinkingTrace steps={stopped} running={false} durationMs={900} />);
    expect(screen.getByRole("button")).toHaveTextContent("Stopped at business check");
  });
});

// ---------------------------------------------------------------------------
// UrgencyBadge
// ---------------------------------------------------------------------------
describe("UrgencyBadge", () => {
  it("renders Critical for urgency 5", () => {
    render(<UrgencyBadge urgency={5} />);
    expect(screen.getByText(/Critical/)).toBeInTheDocument();
    expect(screen.getByText(/\(5\)/)).toBeInTheDocument();
  });

  it("renders High for urgency 4", () => {
    render(<UrgencyBadge urgency={4} />);
    expect(screen.getByText(/High/)).toBeInTheDocument();
  });

  it("renders Medium for urgency 3", () => {
    render(<UrgencyBadge urgency={3} />);
    expect(screen.getByText(/Medium/)).toBeInTheDocument();
  });

  it("renders Low for urgency 2", () => {
    render(<UrgencyBadge urgency={2} />);
    expect(screen.getByText(/Low/)).toBeInTheDocument();
  });

  it("renders None for urgency 1", () => {
    render(<UrgencyBadge urgency={1} />);
    expect(screen.getByText(/None/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// CategoryBadge
// ---------------------------------------------------------------------------
describe("CategoryBadge", () => {
  it("renders known category with emoji and label", () => {
    render(<CategoryBadge category="complaint" />);
    expect(screen.getByText(/Complaint/)).toBeInTheDocument();
    expect(document.querySelector("svg")).toBeInTheDocument();
  });

  it("renders bug_report category", () => {
    render(<CategoryBadge category="bug_report" />);
    expect(screen.getByText(/Bug Report/)).toBeInTheDocument();
  });

  it("falls back to raw string for unknown category", () => {
    render(<CategoryBadge category="custom_category" />);
    expect(screen.getByText(/custom_category/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SentimentBadge
// ---------------------------------------------------------------------------
describe("SentimentBadge", () => {
  it("renders positive sentiment", () => {
    render(<SentimentBadge sentiment="positive" />);
    expect(screen.getByText(/Positive/)).toBeInTheDocument();
    expect(document.querySelector("svg")).toBeInTheDocument();
  });

  it("renders negative sentiment", () => {
    render(<SentimentBadge sentiment="negative" />);
    expect(screen.getByText(/Negative/)).toBeInTheDocument();
  });

  it("renders neutral sentiment", () => {
    render(<SentimentBadge sentiment="neutral" />);
    expect(screen.getByText(/Neutral/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// LoadingSpinner
// ---------------------------------------------------------------------------
describe("LoadingSpinner", () => {
  it("renders with role=status", () => {
    render(<LoadingSpinner />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("has an aria-label", () => {
    render(<LoadingSpinner />);
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
  });

  it("applies sm size class", () => {
    render(<LoadingSpinner size="sm" />);
    const el = screen.getByRole("status");
    expect(el.className).toContain("h-4");
  });

  it("applies lg size class", () => {
    render(<LoadingSpinner size="lg" />);
    const el = screen.getByRole("status");
    expect(el.className).toContain("h-8");
  });
});

// ---------------------------------------------------------------------------
// RemovableTag
// ---------------------------------------------------------------------------
describe("RemovableTag", () => {
  it("renders label text", () => {
    render(<RemovableTag label="Acme" onRemove={() => {}} />);
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });

  it("renders sublabel when provided", () => {
    render(<RemovableTag label="Acme" sublabel="(acme, ACME)" onRemove={() => {}} />);
    expect(screen.getByText("(acme, ACME)")).toBeInTheDocument();
  });

  it("calls onRemove when × is clicked", () => {
    const onRemove = vi.fn();
    render(<RemovableTag label="Acme" onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText("Remove Acme"));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("has accessible remove button", () => {
    render(<RemovableTag label="DataBox" onRemove={() => {}} />);
    expect(screen.getByLabelText("Remove DataBox")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------
describe("EmptyState", () => {
  it("renders title", () => {
    render(<EmptyState title="No data" />);
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("renders message when provided", () => {
    render(<EmptyState title="No data" message="Try again later." />);
    expect(screen.getByText("Try again later.")).toBeInTheDocument();
  });

  it("does not render message paragraph when not provided", () => {
    const { container } = render(<EmptyState title="No data" />);
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Skeleton Components
// ---------------------------------------------------------------------------
describe("StatCardSkeleton", () => {
  it("renders pulse shimmer elements", () => {
    const { container } = render(<StatCardSkeleton />);
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  });
});

describe("PostCardSkeleton", () => {
  it("renders multiple shimmer blocks", () => {
    const { container } = render(<PostCardSkeleton />);
    const shimmers = container.querySelectorAll(".skeleton");
    expect(shimmers.length).toBeGreaterThanOrEqual(5);
  });
});

describe("CategoryBreakdownSkeleton", () => {
  it("renders 4 category row placeholders", () => {
    const { container } = render(<CategoryBreakdownSkeleton />);
    const roundedFull = container.querySelectorAll(".rounded-full");
    expect(roundedFull.length).toBeGreaterThanOrEqual(4);
  });
});

describe("CollectionStatusSkeleton", () => {
  it("renders shimmer placeholders", () => {
    const { container } = render(<CollectionStatusSkeleton />);
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  });
});

describe("ActivityLogSkeleton", () => {
  it("renders 5 log row shimmers", () => {
    const { container } = render(<ActivityLogSkeleton />);
    const shimmers = container.querySelectorAll(".skeleton");
    expect(shimmers.length).toBeGreaterThanOrEqual(5);
  });
});

describe("KeywordSectionSkeleton", () => {
  it("renders tag-like rounded-full elements", () => {
    const { container } = render(<KeywordSectionSkeleton />);
    const pills = container.querySelectorAll(".rounded-full");
    expect(pills.length).toBeGreaterThanOrEqual(4);
  });
});

describe("SubredditSectionSkeleton", () => {
  it("renders shimmer elements", () => {
    const { container } = render(<SubredditSectionSkeleton />);
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  });
});

describe("SearchQuerySectionSkeleton", () => {
  it("renders 4 query row shimmers", () => {
    const { container } = render(<SearchQuerySectionSkeleton />);
    const rows = container.querySelectorAll(".rounded-lg");
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });
});

describe("AppLoadingSkeleton", () => {
  it("renders the Radarr brand initial", () => {
    render(<AppLoadingSkeleton />);
    expect(screen.getByText("R")).toBeInTheDocument();
  });

  it("renders the loading text", () => {
    render(<AppLoadingSkeleton />);
    expect(screen.getByText("Radarr")).toBeInTheDocument();
    expect(screen.getByText(/Loading/)).toBeInTheDocument();
  });

  it("renders a ping animation", () => {
    const { container } = render(<AppLoadingSkeleton />);
    expect(container.querySelector(".loading")).toBeInTheDocument();
  });
});

describe("DashboardSkeleton", () => {
  it("renders 6 stat card skeletons", () => {
    const { container } = render(<DashboardSkeleton />);
    const cards = container.querySelectorAll(".skeleton");
    expect(cards.length).toBeGreaterThanOrEqual(6);
  });
});

describe("FeedSkeleton", () => {
  it("renders filter bar shimmers and 4 post card skeletons", () => {
    const { container } = render(<FeedSkeleton />);
    const shimmers = container.querySelectorAll(".skeleton");
    expect(shimmers.length).toBeGreaterThanOrEqual(10);
  });
});

describe("SettingsSkeleton", () => {
  it("renders keyword, subreddit, and query section skeletons", () => {
    const { container } = render(<SettingsSkeleton />);
    const shimmers = container.querySelectorAll(".skeleton");
    expect(shimmers.length).toBeGreaterThanOrEqual(10);
  });
});
