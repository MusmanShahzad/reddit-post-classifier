import { beforeEach, describe, expect, it, vi } from "vitest";

/** Runs the real suggestion route. The paid Reddit and Jev calls are replaced. */
const mocks = vi.hoisted(() => ({
  searchSubreddits: vi.fn(),
  keepBuyerCommunities: vi.fn(),
}));

vi.mock("@/server/services/reddit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/services/reddit")>();
  return { ...actual, searchSubreddits: mocks.searchSubreddits };
});
vi.mock("@/server/services/classifier", () => ({
  keepBuyerCommunities: mocks.keepBuyerCommunities,
  readGoals: vi.fn(),
  checkGuardrails: vi.fn(),
}));
vi.mock("@/server/services/openai", () => ({
  checkModeration: vi.fn(),
  extractOnboardingConfig: vi.fn(),
  suggestMarketNames: vi.fn(),
}));

import { onboardingRouter } from "@/server/api/routers/onboarding";
import { subredditQueries } from "@/server/services/reddit";

const community = (name: string, subscribers = 10_000) => ({ name, subscribers, description: name });
const suggest = (input: { topics: string[]; product?: string }) =>
  onboardingRouter.createCaller({ db: {}, headers: new Headers() } as never).suggestSubreddits(input);

const topics = [
  "auto repair shop software",
  "shop management software",
  "customer management software",
  "auto repair SaaS",
  "autoleap",
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.keepBuyerCommunities.mockImplementation(async (candidates: unknown[]) => candidates);
});

describe("subredditQueries", () => {
  it("tries the joined topics first, then the trade words of one topic", () => {
    expect(subredditQueries(topics)).toEqual([
      "auto repair shop software shop management software customer management software",
      "auto repair shop",
      "shop management",
    ]);
  });

  it("skips repeats and topics with no usable words", () => {
    expect(subredditQueries(["auto repair", "auto repair software", "best app"])).toEqual([
      "auto repair auto repair software best app",
      "auto repair",
    ]);
  });
});

describe("suggestSubreddits", () => {
  it("uses the joined search and pays for nothing more when it finds communities", async () => {
    mocks.searchSubreddits.mockResolvedValueOnce([
      community("MechanicAdvice", 2_200_000),
      community("autorepair", 63_000),
    ]);

    const result = await suggest({ topics, product: "shop software" });

    expect(mocks.searchSubreddits).toHaveBeenCalledTimes(1);
    expect(mocks.searchSubreddits.mock.calls[0]![0]).toContain("auto repair shop software shop management");
    expect(result.map((sub) => sub.name)).toEqual(["MechanicAdvice", "autorepair"]);
  });

  it("falls back to a shorter search when the joined one finds nothing", async () => {
    mocks.searchSubreddits.mockResolvedValueOnce([]).mockResolvedValueOnce([community("autorepair")]);

    const result = await suggest({ topics });

    expect(mocks.searchSubreddits).toHaveBeenCalledTimes(2);
    expect(mocks.searchSubreddits.mock.calls[1]![0]).toBe("auto repair shop");
    expect(result.map((sub) => sub.name)).toEqual(["autorepair"]);
  });

  it("carries on when one search fails", async () => {
    mocks.searchSubreddits
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce([community("autorepair")]);

    expect((await suggest({ topics })).map((sub) => sub.name)).toEqual(["autorepair"]);
  });

  it("uses the Jev check only when the product is known", async () => {
    mocks.searchSubreddits.mockResolvedValue([community("autorepair")]);

    await suggest({ topics });
    expect(mocks.keepBuyerCommunities).not.toHaveBeenCalled();

    await suggest({ topics, product: "shop software" });
    expect(mocks.keepBuyerCommunities).toHaveBeenCalledWith(expect.any(Array), { product: "shop software" });
  });
});
