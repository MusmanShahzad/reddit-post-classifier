import { describe, expect, it } from "vitest";
import { ExtractionOutputSchema } from "@/server/services/openai";

/** The shape GPT-4o actually returned for "We sell home decor". */
const homeDecorReply = {
  conversationalReply: "Who usually buys your home decor?",
  needsClarification: true,
  followUpQuestions: "Who buys it?",
  isConfirmation: false,
  config: {
    companyName: null,
    product: "home decor",
    buyer: null,
    keepWhen: "bad reviews of my product",
    notAbout: null,
    brandKeywords: "home decor",
    competitorKeywords: [],
    topicKeywords: ["home decor bad review"],
    focusAreas: "bad reviews of home decor",
  },
};

describe("ExtractionOutputSchema", () => {
  it("keeps the answers when focusAreas comes back as one sentence", () => {
    const result = ExtractionOutputSchema.parse(homeDecorReply);
    expect(result.config?.product).toBe("home decor");
    expect(result.config?.keepWhen).toBe("bad reviews of my product");
    expect(result.config?.buyer).toBe("");
    expect(result.config?.focusAreas).toEqual(["bad reviews of home decor"]);
    expect(result.config?.brandKeywords).toEqual([{ value: "home decor", aliases: [] }]);
    expect(result.config?.topicKeywords).toEqual([{ value: "home decor bad review" }]);
    expect(result.followUpQuestions).toEqual(["Who buys it?"]);
    expect(result.conversationalReply).toContain("home decor");
  });

  it("drops nothing when a keyword or a phrase is longer than the limit", () => {
    const result = ExtractionOutputSchema.parse({
      ...homeDecorReply,
      conversationalReply: "x".repeat(2500),
      config: {
        ...homeDecorReply.config,
        keepWhen: "k".repeat(500),
        focusAreas: ["f".repeat(300), "second"],
        topicKeywords: "t".repeat(250),
      },
    });
    expect(result.conversationalReply).toHaveLength(2000);
    expect(result.config?.keepWhen).toHaveLength(400);
    expect(result.config?.focusAreas[0]).toHaveLength(200);
    expect(result.config?.focusAreas).toHaveLength(2);
    expect(result.config?.topicKeywords[0]?.value).toHaveLength(200);
  });
});
