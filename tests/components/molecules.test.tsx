/**
 * Molecule Component Tests
 *
 * Tests for composite components built from atoms. Each molecule is tested
 * for correct composition, interaction handling, and prop forwarding.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  TagList,
  AddItemInput,
  PostActions,
  QuestionModal,
  BriefExtrasModal,
  NOTHING_TO_SKIP,
  CollectionStats,
  SessionSwitcher,
} from "@/components/molecules";

describe("SessionSwitcher", () => {
  const sessions = [
    { id: "a", label: "AutoLeap", keepWhen: "bad reviews", relevant: 3, posts: 40 },
    { id: "b", label: "Deskly buyers", keepWhen: "people about to buy a desk", relevant: 0, posts: 0 },
  ];
  const handlers = () => ({ onSelect: vi.fn(), onCreate: vi.fn(), onDelete: vi.fn() });

  it("lists sessions with what each one looks for and marks the active one", () => {
    render(<SessionSwitcher sessions={sessions} activeId="a" {...handlers()} />);
    expect(screen.getByText("bad reviews")).toBeInTheDocument();
    expect(screen.getByText("AutoLeap").closest("[aria-current]")).toHaveTextContent("3 relevant · 40 saved");
    expect(screen.getByText("AutoLeap").closest("[aria-current]")).toHaveAttribute("aria-current", "true");
  });

  it("switches on click and starts a new session", () => {
    const h = handlers();
    render(<SessionSwitcher sessions={sessions} activeId="a" {...h} />);
    fireEvent.click(screen.getByText("Deskly buyers"));
    expect(h.onSelect).toHaveBeenCalledWith("b");
    fireEvent.click(screen.getByText("New"));
    expect(h.onCreate).toHaveBeenCalledOnce();
  });

  it("deletes only after a confirm, and cancel keeps it", () => {
    const h = handlers();
    render(<SessionSwitcher sessions={sessions} activeId="a" {...h} />);

    fireEvent.click(screen.getByLabelText("Delete AutoLeap"));
    expect(h.onDelete).not.toHaveBeenCalled();
    expect(h.onSelect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Cancel delete"));
    expect(h.onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Delete AutoLeap"));
    fireEvent.click(screen.getByLabelText("Confirm delete AutoLeap"));
    expect(h.onDelete).toHaveBeenCalledWith("a");
  });
});

// ---------------------------------------------------------------------------
// TagList
// ---------------------------------------------------------------------------
describe("TagList", () => {
  it("renders all tags", () => {
    render(
      <TagList
        tags={[
          { label: "Acme", onRemove: vi.fn() },
          { label: "DataBox", onRemove: vi.fn() },
        ]}
      />,
    );
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("DataBox")).toBeInTheDocument();
  });

  it("renders nothing for empty array", () => {
    const { container } = render(<TagList tags={[]} />);
    expect(container.firstChild?.childNodes.length).toBe(0);
  });

  it("calls individual onRemove handlers", () => {
    const onRemove1 = vi.fn();
    const onRemove2 = vi.fn();
    render(
      <TagList
        tags={[
          { label: "A", onRemove: onRemove1 },
          { label: "B", onRemove: onRemove2 },
        ]}
      />,
    );
    fireEvent.click(screen.getByLabelText("Remove A"));
    expect(onRemove1).toHaveBeenCalledOnce();
    expect(onRemove2).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AddItemInput
// ---------------------------------------------------------------------------
describe("AddItemInput", () => {
  it("calls onAdd with trimmed value on button click", () => {
    const onAdd = vi.fn();
    render(<AddItemInput placeholder="Add..." onAdd={onAdd} />);
    const input = screen.getByPlaceholderText("Add...");
    fireEvent.change(input, { target: { value: " Acme Corp " } });
    fireEvent.click(screen.getByText("Add"));
    expect(onAdd).toHaveBeenCalledWith("Acme Corp");
  });

  it("calls onAdd on Enter key", () => {
    const onAdd = vi.fn();
    render(<AddItemInput placeholder="Add..." onAdd={onAdd} />);
    const input = screen.getByPlaceholderText("Add...");
    fireEvent.change(input, { target: { value: "Test" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("Test");
  });

  it("clears input after successful add", () => {
    render(<AddItemInput placeholder="Add..." onAdd={() => {}} />);
    const input = screen.getByPlaceholderText("Add...") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Test" } });
    fireEvent.click(screen.getByText("Add"));
    expect(input.value).toBe("");
  });

  it("does not call onAdd for empty input", () => {
    const onAdd = vi.fn();
    render(<AddItemInput placeholder="Add..." onAdd={onAdd} />);
    fireEvent.click(screen.getByText("Add"));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("applies transform before calling onAdd", () => {
    const onAdd = vi.fn();
    render(
      <AddItemInput
        placeholder="Add..."
        onAdd={onAdd}
        transform={(v) => v.replace(/^r\//, "")}
      />,
    );
    const input = screen.getByPlaceholderText("Add...");
    fireEvent.change(input, { target: { value: "r/webdev" } });
    fireEvent.click(screen.getByText("Add"));
    expect(onAdd).toHaveBeenCalledWith("webdev");
  });

  it("disables input and button when disabled", () => {
    render(<AddItemInput placeholder="Add..." onAdd={() => {}} disabled />);
    expect(screen.getByPlaceholderText("Add...")).toBeDisabled();
    expect(screen.getByText("Add")).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// PostActions
// ---------------------------------------------------------------------------
describe("PostActions", () => {
  const defaultProps = {
    permalink: "https://reddit.com/r/test/abc",
    onHandle: vi.fn(),
    onDismiss: vi.fn(),
    onReopen: vi.fn(),
  };

  it("renders Handle and Dismiss for new posts", () => {
    render(<PostActions {...defaultProps} status="new" />);
    expect(screen.getByText("Mark handled")).toBeInTheDocument();
    expect(screen.getByText("Dismiss")).toBeInTheDocument();
  });

  it("renders Reopen for handled posts", () => {
    render(<PostActions {...defaultProps} status="handled" />);
    expect(screen.getByText("Reopen")).toBeInTheDocument();
    expect(screen.queryByText("Mark handled")).not.toBeInTheDocument();
  });

  it("calls onHandle when Mark Handled is clicked", () => {
    const onHandle = vi.fn();
    render(<PostActions {...defaultProps} status="new" onHandle={onHandle} />);
    fireEvent.click(screen.getByText("Mark handled"));
    expect(onHandle).toHaveBeenCalledOnce();
  });

  it("calls onDismiss when Dismiss is clicked", () => {
    const onDismiss = vi.fn();
    render(<PostActions {...defaultProps} status="new" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("calls onReopen when Reopen is clicked", () => {
    const onReopen = vi.fn();
    render(<PostActions {...defaultProps} status="handled" onReopen={onReopen} />);
    fireEvent.click(screen.getByText("Reopen"));
    expect(onReopen).toHaveBeenCalledOnce();
  });

  it("renders Reddit link with correct href", () => {
    render(<PostActions {...defaultProps} status="new" />);
    const link = screen.getByText("Open on Reddit");
    expect(link).toHaveAttribute("href", "https://reddit.com/r/test/abc");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("disables buttons when disabled=true", () => {
    render(<PostActions {...defaultProps} status="new" disabled />);
    expect(screen.getByText("Mark handled")).toBeDisabled();
    expect(screen.getByText("Dismiss")).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// BriefExtrasModal
// ---------------------------------------------------------------------------
describe("BriefExtrasModal", () => {
  it("saves trimmed answers", () => {
    const onSave = vi.fn();
    render(<BriefExtrasModal companyName="Acme" onSave={onSave} onDismiss={() => {}} />);
    fireEvent.change(screen.getByLabelText("Who buys it?"), { target: { value: "  Renters  " } });
    fireEvent.change(screen.getByLabelText("What should be skipped?"), { target: { value: " Jobs " } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSave).toHaveBeenCalledWith({ buyer: "Renters", notAbout: "Jobs" });
  });

  it("saves a clear answer when there is nothing to skip", () => {
    const onSave = vi.fn();
    render(<BriefExtrasModal companyName="Acme" onSave={onSave} onDismiss={() => {}} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Nothing to skip" }));
    expect(screen.getByLabelText("What should be skipped?")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSave).toHaveBeenCalledWith({ buyer: "", notAbout: NOTHING_TO_SKIP });
  });

  it("can be left for later", () => {
    const onDismiss = vi.fn();
    render(<BriefExtrasModal companyName="Acme" onSave={() => {}} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// QuestionModal
// ---------------------------------------------------------------------------
describe("QuestionModal", () => {
  it("shows the question", () => {
    render(<QuestionModal question="What does Acme sell?" onAnswer={() => {}} />);
    expect(screen.getByText("What does Acme sell?")).toBeInTheDocument();
  });

  it("keeps Continue disabled until there is an answer", () => {
    render(<QuestionModal question="Q?" onAnswer={() => {}} />);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("sends the trimmed answer when Continue is clicked", () => {
    const onAnswer = vi.fn();
    render(<QuestionModal question="Q?" onAnswer={onAnswer} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  Lamps  " } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onAnswer).toHaveBeenCalledWith("Lamps");
  });

  it("sends on Enter but not on Shift+Enter", () => {
    const onAnswer = vi.fn();
    render(<QuestionModal question="Q?" onAnswer={onAnswer} />);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "Lamps" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter", shiftKey: false });
    expect(onAnswer).toHaveBeenCalledOnce();
  });

  it("offers Cancel only when it can close", () => {
    const onCancel = vi.fn();
    const { rerender } = render(<QuestionModal question="Q?" onAnswer={() => {}} />);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    rerender(<QuestionModal question="Q?" onAnswer={() => {}} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// CollectionStats
// ---------------------------------------------------------------------------
describe("CollectionStats", () => {
  it("renders all stat values", () => {
    render(
      <CollectionStats
        startedAt="2024-03-15T10:30:00Z"
        totalFetched={240}
        totalNew={38}
        totalRelevant={12}
      />,
    );
    expect(screen.getByText("240")).toBeInTheDocument();
    expect(screen.getByText("38")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("renders labels", () => {
    render(
      <CollectionStats
        startedAt={new Date().toISOString()}
        totalFetched={0}
        totalNew={0}
        totalRelevant={0}
      />,
    );
    expect(screen.getByText("Last run:")).toBeInTheDocument();
    expect(screen.getByText("Posts found:")).toBeInTheDocument();
    expect(screen.getByText("New posts:")).toBeInTheDocument();
    expect(screen.getByText("Kept:")).toBeInTheDocument();
  });
});
