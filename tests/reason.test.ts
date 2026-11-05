import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generatePostReason: vi.fn(),
  reasonIsBacked: vi.fn(),
}));

vi.mock("@/server/services/openai", () => ({ generatePostReason: mocks.generatePostReason }));
vi.mock("@/server/services/classifier", () => ({ reasonIsBacked: mocks.reasonIsBacked }));

import { fallbackReason, reasonProblems } from "@/lib/reason-checks";
import { writeReason } from "@/server/services/reason";

const names = ["QuickBooks", "Xero"];
const postText = "Quickbooks payroll took my tax payment early and support will not answer";
const check = (text: string) => reasonProblems({ text, postText, names });

describe("reasonProblems", () => {
  it("accepts a factual third-person line", () => {
    expect(check("A small business owner says QuickBooks payroll takes tax payments early and support does not answer.")).toEqual([]);
  });

  // Real lines the old prompt produced.
  it.each([
    ["I'm about to open my first repair shop and need real feedback."],
    ["As a job seeker passionate about remote work, I'm excited to share this opening."],
    ["Struggling with payroll, my team needs answers."],
  ])("rejects first person: %s", (line) => {
    expect(check(line).join()).toContain("first person");
  });

  it("does not mistake a capital US or other words for first person", () => {
    expect(check("The author says tax payments left early and support did not answer.")).toEqual([]);
  });

  it("rejects a product the post never mentions", () => {
    expect(check("The author wishes they had moved to Xero after the payroll problem.").join()).toContain("Xero");
  });

  it("accepts a product named with different spacing or case in the post", () => {
    expect(reasonProblems({ text: "The author compares QuickBooks plans.", postText: "thinking about quick books", names })).toEqual([]);
  });

  it("rejects an instruction at the end", () => {
    expect(check("The author reports an early tax payment and wants help. Reply.").join()).toContain("instruction");
  });

  it("rejects an overlong line and an empty one", () => {
    expect(check(Array.from({ length: 31 }, () => "word").join(" ")).join()).toContain("longer");
    expect(check("  ")).toEqual(["it is empty"]);
  });
});

describe("fallbackReason", () => {
  it("states only the post type and its title", () => {
    expect(fallbackReason("bug_report", "App keeps crashing")).toBe("Bug report post: App keeps crashing");
    expect(fallbackReason("other", "A question")).toBe("Post: A question");
  });

  it("shortens a long title", () => {
    const line = fallbackReason("praise", Array.from({ length: 40 }, () => "word").join(" "));
    expect(line.endsWith("...")).toBe(true);
    expect(line.split(" ").length).toBeLessThanOrEqual(23);
  });
});

describe("writeReason", () => {
  const input = {
    post: { title: "QuickBooks payroll took my money", body: postText, subreddit: "complaints" },
    companyName: "QuickBooks",
    category: "complaint",
    keepWhen: "Complaints, bugs and reviews",
    names,
  };
  const good = "A business owner says QuickBooks payroll takes tax payments early and support does not answer.";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reasonIsBacked.mockResolvedValue(true);
  });

  it("returns a draft that passes both checks", async () => {
    mocks.generatePostReason.mockResolvedValue(good);
    expect(await writeReason(input)).toBe(good);
    expect(mocks.generatePostReason).toHaveBeenCalledTimes(1);
  });

  it("retries with the reason when a draft fails the free checks, without paying Jev", async () => {
    mocks.generatePostReason.mockResolvedValueOnce("I'm frustrated with payroll.").mockResolvedValueOnce(good);

    expect(await writeReason(input)).toBe(good);
    expect(mocks.generatePostReason.mock.calls[1]![0].correction).toContain("first person");
    expect(mocks.reasonIsBacked).toHaveBeenCalledTimes(1);
  });

  it("retries when Jev says the post does not back the line", async () => {
    mocks.generatePostReason.mockResolvedValue(good);
    mocks.reasonIsBacked.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    expect(await writeReason(input)).toBe(good);
    expect(mocks.generatePostReason.mock.calls[1]![0].correction).toContain("does not say");
  });

  it("falls back to a plain label when no draft passes", async () => {
    mocks.generatePostReason.mockResolvedValue("I wish I had used Xero.");

    expect(await writeReason(input)).toBe("Complaint post: QuickBooks payroll took my money");
    expect(mocks.generatePostReason).toHaveBeenCalledTimes(2);
  });

  it("falls back when the model gives no answer", async () => {
    mocks.generatePostReason.mockResolvedValue(null);
    expect(await writeReason(input)).toBe("Complaint post: QuickBooks payroll took my money");
  });
});
