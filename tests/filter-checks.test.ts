import { describe, expect, it } from "vitest";
import {
  aliasList,
  askedMood,
  filterQuality,
  findEvidence,
  judgeDecision,
  measureFilter,
  sessionEvidence,
} from "@/lib/filter-checks";

const session = {
  name: "Nestly",
  product: "home decor and wall art",
  buyer: "",
  keepWhen: "bad reviews of our products",
  notAbout: "",
  keywords: [
    { type: "brand", value: "Nestly", aliases: '["nestly.co"]' },
    { type: "competitor", value: "Wayfair", aliases: "[]" },
    { type: "topic", value: "home decor", aliases: "[]" },
  ],
};

describe("findEvidence", () => {
  it("finds brand and competitor names as whole words", () => {
    const evidence = findEvidence({
      title: "Wayfair lamp broke",
      body: "Also tried Nestly",
      brands: ["Nestly"],
      competitors: ["Wayfair"],
    });
    expect(evidence.names).toEqual(["Nestly", "Wayfair"]);
  });

  it("does not match a name inside another word", () => {
    const evidence = findEvidence({ title: "Unnestlyish", body: "", brands: ["Nestly"], competitors: [] });
    expect(evidence.names).toEqual([]);
  });

  it("matches product words, singular or plural, and ignores common words", () => {
    const evidence = findEvidence({
      title: "My new rug",
      body: "the decor looks cheap, bad product",
      brands: [],
      competitors: [],
      product: "rugs and home decor products",
    });
    expect(evidence.productWords).toContain("rug");
    expect(evidence.productWords).toContain("decor");
    expect(evidence.productWords).not.toContain("product");
  });
});

describe("aliasList", () => {
  it("reads JSON and comma lists", () => {
    expect(aliasList('["a","b"]')).toEqual(["a", "b"]);
    expect(aliasList("a, b")).toEqual(["a", "b"]);
    expect(aliasList("")).toEqual([]);
  });
});

describe("askedMood", () => {
  it("reads the mood of what the user asked for", () => {
    expect(askedMood("bad reviews of my product")).toBe("negative");
    expect(askedMood("people who love our app")).toBe("positive");
    expect(askedMood("questions about pricing")).toBeNull();
  });
});

describe("judgeDecision", () => {
  const backed = sessionEvidence({ title: "Nestly frame fell apart", body: "" }, session);
  const unbacked = sessionEvidence({ title: "Weekend plans?", body: "Any ideas" }, session);

  it("shows a clear, backed match", () => {
    const decision = judgeDecision({
      score: 0.9,
      threshold: 0.7,
      evidence: backed,
      keepWhen: session.keepWhen,
      sentiment: "negative",
      sentimentConfidence: 0.9,
    });
    expect(decision.verdict).toBe("show");
  });

  it("skips a clearly low score", () => {
    expect(judgeDecision({ score: 0.3, threshold: 0.7, evidence: backed }).verdict).toBe("skip");
  });

  it("shows a clear match that names no brand or product", () => {
    const decision = judgeDecision({ score: 0.95, threshold: 0.7, evidence: unbacked });
    expect(decision.verdict).toBe("show");
  });

  it("holds an unsure score on either side of the old line", () => {
    for (const score of [0.35, 0.58, 0.69]) {
      const decision = judgeDecision({ score, threshold: 0.7, evidence: backed });
      expect(decision.verdict).toBe("review");
      expect(decision.borderline).toBe(true);
    }
  });

  it("shows a clear lead even when the free-text request scores it modestly", () => {
    expect(judgeDecision({ score: 0.97, threshold: 0.7, evidence: backed, requestScore: 0.26 }).verdict).toBe("show");
  });

  it("holds a post that clearly is not what they asked to find", () => {
    const decision = judgeDecision({ score: 0.9, threshold: 0.7, evidence: backed, requestScore: 0.05 });
    expect(decision.verdict).toBe("review");
    expect(decision.checks.find((check) => check.id === "request")?.passed).toBe(false);
  });

  it("shows a score exactly on the threshold", () => {
    expect(judgeDecision({ score: 0.7, threshold: 0.7, evidence: backed }).verdict).toBe("show");
  });

  it("holds praise when the user asked for bad reviews", () => {
    const decision = judgeDecision({
      score: 0.9,
      threshold: 0.7,
      evidence: backed,
      keepWhen: "bad reviews",
      sentiment: "positive",
      sentimentConfidence: 0.8,
    });
    expect(decision.verdict).toBe("review");
  });

  it("does not hold on an unsure sentiment", () => {
    const decision = judgeDecision({
      score: 0.9,
      threshold: 0.7,
      evidence: backed,
      keepWhen: "bad reviews",
      sentiment: "positive",
      sentimentConfidence: 0.4,
    });
    expect(decision.verdict).toBe("show");
  });
});

describe("filter quality", () => {
  it("reports nothing before posts are classified", () => {
    const quality = measureFilter(session, [], 0.6);
    expect(quality.score).toBeNull();
  });

  describe("when nothing has reached the feed", () => {
    const counts = {
      classified: 9,
      shown: 0,
      review: 4,
      borderline: 3,
      shownWithEvidence: 0,
      confirmed: 0,
      rejected: 0,
      rescued: 0,
      briefFilled: 3,
      briefTotal: 5,
    };

    it("gives no score and says so, instead of looking healthy", () => {
      const quality = filterQuality(counts);
      expect(quality.score).toBeNull();
      expect(quality.warning).toContain("None of the 9 classified posts have reached the feed");
      expect(quality.warning).toContain("4 wait for your check");
    });

    it("drops the warning once a post is shown", () => {
      const quality = filterQuality({ ...counts, shown: 1, shownWithEvidence: 1 });
      expect(quality.score).not.toBeNull();
      expect(quality.warning).toBeNull();
    });

    it("has no warning before anything is classified", () => {
      expect(filterQuality({ ...counts, classified: 0, review: 0 }).warning).toBeNull();
    });
  });

  it("waits for enough feedback before reporting precision", () => {
    const quality = filterQuality({
      classified: 10,
      shown: 4,
      review: 1,
      borderline: 1,
      shownWithEvidence: 4,
      confirmed: 2,
      rejected: 1,
      rescued: 0,
      briefFilled: 3,
      briefTotal: 5,
    });
    expect(quality.metrics.find((metric) => metric.id === "precision")?.value).toBeNull();
    expect(quality.metrics.find((metric) => metric.id === "evidence")?.value).toBe(1);
  });

  it("counts shown, held, rescued, and user feedback from saved posts", () => {
    const post = (title: string, isRelevant: boolean, relevanceScore: number, status: string) => ({
      title,
      body: "",
      isRelevant,
      relevanceScore,
      status,
    });
    const quality = measureFilter(
      session,
      [
        post("Nestly mirror cracked", true, 0.9, "handled"),
        post("Wayfair rug faded", true, 0.85, "dismissed"),
        post("Random chat", true, 0.8, "new"),
        post("Unsure one", true, 0.65, "review"),
        post("Moved in by hand", true, 0.3, "new"),
        post("Off topic", false, 0.1, "filtered"),
      ],
      0.7,
    );
    expect(quality.counts).toMatchObject({
      classified: 6,
      shown: 3,
      review: 1,
      rescued: 1,
      shownWithEvidence: 2,
      confirmed: 1,
      rejected: 1,
      borderline: 1,
      briefFilled: 3,
    });
    expect(quality.score).not.toBeNull();
  });

  it("names the brief answers that are still missing", () => {
    const quality = measureFilter({ ...session, buyer: "", notAbout: "" }, [], 0.6);
    const brief = quality.metrics.find((metric) => metric.id === "brief");
    expect(brief?.detail).toBe("3 of 5 answers. Still missing: who buys it and what to skip");
  });
});
