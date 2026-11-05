import { beforeEach, describe, expect, it, vi } from "vitest";

const systemOne = vi.hoisted(() => vi.fn());

vi.mock("@typesafe-ai/sdk", () => ({
  TypeSafeClient: class {
    systemOne = systemOne;
  },
  noul: (instructions: string) => ({ type: "noul", instructions }),
  choice: () => ({}),
  score: () => ({}),
}));

import { mentionsName } from "@/lib/filter-checks";
import { namesInQuery } from "@/lib/post-tags";
import { ExtractionOutputSchema } from "@/server/services/openai";
import { keepBuyerCommunities } from "@/server/services/classifier";

const keyword = (type: string, value: string, aliases: string[] = []) => ({
  id: value,
  type,
  value,
  aliases: JSON.stringify(aliases),
});

describe("mentionsName", () => {
  it("finds a name however it is spaced", () => {
    expect(mentionsName("debating between autoleap and shop monkey", "Shopmonkey")).toBe(true);
    expect(mentionsName("each shop has a license for Mitchell 1", "Mitchell1")).toBe(true);
    expect(mentionsName("we use AutoLeap", "Auto Leap")).toBe(true);
  });

  it("does not match a name inside another word", () => {
    expect(mentionsName("the shopmonkeys are out", "Shopmonkey")).toBe(false);
    expect(mentionsName("my cardano wallet", "car")).toBe(false);
  });

  it("does not split very short names", () => {
    expect(mentionsName("a c b 2 thing", "CB2")).toBe(false);
    expect(mentionsName("I bought it from CB2", "CB2")).toBe(true);
  });
});

describe("namesInQuery", () => {
  const keywords = [
    keyword("brand", "AutoLeap", ["Auto Leap"]),
    keyword("competitor", "Tekmetric"),
    keyword("topic", "auto repair software"),
  ];

  it("returns the name and aliases for a name search", () => {
    expect(namesInQuery('"Auto Leap"', keywords)).toEqual(["AutoLeap", "Auto Leap"]);
    expect(namesInQuery('"Tekmetric" ("auto repair")', keywords)).toEqual(["Tekmetric"]);
  });

  it("returns nothing for a topic search", () => {
    expect(namesInQuery('"auto repair software"', keywords)).toEqual([]);
  });
});

describe("competitor aliases in onboarding", () => {
  it("keeps aliases and the ambiguous flag", () => {
    const parsed = ExtractionOutputSchema.parse({
      config: {
        companyName: "AutoLeap",
        competitorKeywords: [
          { value: "Shopmonkey", aliases: ["shop monkey"] },
          { value: "Article", aliases: [], ambiguous: true },
          "Tekmetric",
        ],
      },
      conversationalReply: "Ok",
    });

    expect(parsed.config?.competitorKeywords).toEqual([
      { value: "Shopmonkey", aliases: ["shop monkey"] },
      { value: "Article", aliases: [], ambiguous: true },
      { value: "Tekmetric", aliases: [] },
    ]);
  });
});

describe("keepBuyerCommunities", () => {
  const communities = [
    { name: "interiordecorating", description: "Decorating homes" },
    { name: "wallpapers", description: "Phone and desktop backgrounds" },
  ];

  beforeEach(() => {
    systemOne.mockReset();
  });

  it("keeps only the communities Jev says fit the buyers", async () => {
    systemOne.mockResolvedValue({
      answers: { community_0: { noul: 0.9 }, community_1: { noul: 0.1 } },
    });

    const kept = await keepBuyerCommunities(communities, { product: "wall stickers" });

    expect(kept.map((c) => c.name)).toEqual(["interiordecorating"]);
    expect(systemOne).toHaveBeenCalledTimes(1);
  });

  it("puts the communities where buyers decide first, because only the first few fit in a search", async () => {
    systemOne.mockResolvedValue({
      answers: {
        community_0: { noul: 0.9 },
        decider_0: { noul: 0.2 },
        community_1: { noul: 0.8 },
        decider_1: { noul: 0.7 },
      },
    });

    const kept = await keepBuyerCommunities(communities, { product: "wall stickers" });

    expect(kept.map((c) => c.name)).toEqual(["wallpapers", "interiordecorating"]);
  });

  it("removes only a clear no", async () => {
    systemOne.mockResolvedValue({
      answers: { community_0: { noul: 0.35 }, community_1: { noul: 0.3 } },
    });

    const kept = await keepBuyerCommunities(communities, { product: "wall stickers" });

    expect(kept.map((c) => c.name)).toEqual(["interiordecorating"]);
  });

  it("keeps the best few when every score is low, so the list is never emptied", async () => {
    systemOne.mockResolvedValue({
      answers: { community_0: { noul: 0.05 }, community_1: { noul: 0.2 } },
    });

    const kept = await keepBuyerCommunities(communities, { product: "wall stickers" });

    expect(kept.map((c) => c.name)).toEqual(["wallpapers", "interiordecorating"]);
  });

  it("keeps every candidate when Jev cannot be reached", async () => {
    systemOne.mockRejectedValue(new Error("down"));
    await expect(keepBuyerCommunities(communities, { product: "wall stickers" })).resolves.toEqual(communities);
  });

  it("makes no paid call when there is nothing to score", async () => {
    await expect(keepBuyerCommunities([], { product: "wall stickers" })).resolves.toEqual([]);
    expect(systemOne).not.toHaveBeenCalled();
  });
});
