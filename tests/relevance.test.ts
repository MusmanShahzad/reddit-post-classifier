import { describe, expect, it } from "vitest";
import { chatSummary, cleanBrief, combineRelevance, declinesSkip, leadBuyerScore, missingBrief, monitoringScope, postExcerpt, relevanceStatements, replyGuidance, starterIssue, urgencyWhenShown } from "@/lib/relevance";

const keywords = [
  { type: "brand", value: "AutoLeap" },
  { type: "competitor", value: "Shopmonkey" },
  { type: "competitor", value: "Tekmetric" },
  { type: "topic", value: "auto repair software" },
  { type: "topic", value: "mechanic software" },
  { type: "topic", value: "shop management" },
  { type: "topic", value: "customer reviews" },
];

describe("monitoring scope", () => {
  it("keeps topics that name the product and treats broad ones as hints", () => {
    expect(monitoringScope(keywords)).toMatchObject({
      brands: ["AutoLeap"],
      competitors: ["Shopmonkey", "Tekmetric"],
      definingTopics: ["auto repair software", "mechanic software"],
      broadTopics: ["shop management", "customer reviews"],
    });
  });
});

describe("relevance statements", () => {
  it("gives each rule from the user's answers its own statement", () => {
    const statements = relevanceStatements({
      companyName: "Oak & Co",
      scope: monitoringScope([
        { type: "brand", value: "Oak & Co" },
        { type: "topic", value: "office chairs" },
      ]),
      brief: {
        product: "office furniture",
        buyer: "people furnishing a home or office",
        keepWhen: "someone is asking which chair or desk to buy",
        notAbout: "PC parts, desk mats sold as computer accessories, car seats",
      },
    });

    expect(statements.about_market).toContain("office furniture");
    expect(statements.buying_intent).toContain("office furniture");
    expect(statements.about_brand).toContain("Oak & Co");
    expect(statements.matches_request).toContain("someone is asking which chair or desk to buy");
    expect(statements.excluded).toContain("car seats");
    expect(JSON.stringify(statements)).not.toContain("software");
  });

  it("leaves out rules the user did not give", () => {
    const statements = relevanceStatements({
      companyName: "AutoLeap",
      scope: monitoringScope(keywords),
      brief: { product: "shop software", buyer: "", keepWhen: "", notAbout: "nothing in particular" },
    });

    expect(Object.keys(statements).sort()).toEqual([
      "about_brand",
      "about_competitor",
      "about_market",
      "buying_intent",
      "competitor_market",
      "promotional",
    ]);
  });

  it("asks only about the brand when the goal is the brand's own feedback", () => {
    const statements = relevanceStatements({
      companyName: "QuickBooks",
      scope: monitoringScope([
        { type: "brand", value: "QuickBooks" },
        { type: "competitor", value: "Xero" },
      ]),
      goals: ["own_feedback"],
      brandAliases: ["QBO"],
      brief: { product: "accounting software", keepWhen: "Complaints, bugs and reviews" },
    });

    expect(Object.keys(statements).sort()).toEqual(["about_brand", "matches_request", "promotional"]);
    expect(statements.about_brand).toContain("QBO");
    expect(JSON.stringify(statements)).not.toContain("Xero");
  });

  it("asks about the market when competitor feedback has no competitors to ask about", () => {
    const statements = relevanceStatements({
      companyName: "Oak",
      scope: monitoringScope([{ type: "brand", value: "Oak" }]),
      goals: ["competitor_feedback"],
      brief: { product: "chairs" },
    });

    expect(statements.about_competitor).toBeUndefined();
    expect(statements.about_market).toContain("chairs");
  });

  it("asks about the buyer only when looking for leads and a buyer was given", () => {
    const ask = (goals: ("own_feedback" | "potential_clients")[], buyer: string) =>
      relevanceStatements({
        companyName: "AutoLeap",
        scope: monitoringScope(keywords),
        goals,
        brief: { product: "shop software", buyer, keepWhen: "", notAbout: "" },
      }).buyer_match;

    expect(ask(["potential_clients"], "shop owners")).toContain("shop owners");
    expect(ask(["potential_clients"], " ")).toBeUndefined();
    expect(ask(["own_feedback"], "shop owners")).toBeUndefined();
  });
});

describe("buyer rules", () => {
  const lead = { about_market: 0.9, buying_intent: 0.8, promotional: 0 };

  it("skips a lead only when the author is clearly not the buyer", () => {
    expect(combineRelevance({ ...lead, buyer_match: 0.05 })).toBe(0);
    expect(combineRelevance({ ...lead, buyer_match: 0.1 })).toBe(0);
  });

  it("does not lower the score of a lead on a doubtful buyer, since a loose answer rejected clear leads", () => {
    expect(combineRelevance({ ...lead, buyer_match: 0.2 })).toBeCloseTo(0.8);
  });

  it("does not use the buyer against feedback about the brand or a competitor", () => {
    expect(combineRelevance({ ...lead, about_brand: 0.95, buyer_match: 0.01 })).toBeCloseTo(0.95);
    expect(leadBuyerScore({ ...lead, about_brand: 0.95, buyer_match: 0.2 })).toBeNull();
    expect(leadBuyerScore({ ...lead, about_competitor: 0.95, competitor_market: 0.9, buyer_match: 0.2 })).toBeNull();
  });

  it("reports the buyer score when the post is only a lead", () => {
    expect(leadBuyerScore({ ...lead, buyer_match: 0.2 })).toBe(0.2);
    expect(leadBuyerScore(lead)).toBeNull();
    expect(leadBuyerScore(null)).toBeNull();
  });
});

describe("combineRelevance", () => {
  it.each([
    ["a shop owner choosing software", { about_market: 0.98, buying_intent: 0.95, promotional: 0.03 }, 0.95],
    ["someone using a product but not choosing one", { about_market: 0.9, buying_intent: 0.1, promotional: 0 }, 0.1],
    ["a vendor's advert", { about_market: 0.95, buying_intent: 0.9, promotional: 0.99 }, 0.01],
    ["a basketball thread", { about_market: 0.02, buying_intent: 0.01, promotional: 0.03 }, 0.01],
  ])("scores %s for a potential-client goal", (_label, scores, expected) => {
    expect(combineRelevance(scores)).toBeCloseTo(expected);
  });

  it("scores a generic post low when the goal is the brand's own feedback", () => {
    expect(combineRelevance({ about_brand: 0.05, promotional: 0.01 })).toBeCloseTo(0.05);
    expect(combineRelevance({ about_brand: 0.95, promotional: 0.01 })).toBeCloseTo(0.95);
  });

  it("keeps a post that serves any one of several goals", () => {
    expect(
      combineRelevance({ about_brand: 0.02, about_market: 0.9, buying_intent: 0.92, promotional: 0 }),
    ).toBeCloseTo(0.9);
  });

  it("does not count a post about a competitor unless it is about this market", () => {
    expect(combineRelevance({ about_competitor: 0.89, competitor_market: 0.12, promotional: 0.02 })).toBeCloseTo(0.12);
    expect(combineRelevance({ about_competitor: 0.91, competitor_market: 0.96, promotional: 0.02 })).toBeCloseTo(0.91);
  });

  it("does not let the market question affect a post about the brand itself", () => {
    expect(combineRelevance({ about_brand: 0.9, about_competitor: 0.1, competitor_market: 0.02, promotional: 0 })).toBeCloseTo(0.9);
  });

  it("does not let the free-text request lower the score", () => {
    expect(combineRelevance({ about_brand: 0.9, matches_request: 0.01, promotional: 0 })).toBeCloseTo(0.9);
  });

  it("applies a skip rule the user wrote", () => {
    expect(combineRelevance({ about_brand: 0.9, excluded: 0.95, promotional: 0 })).toBeCloseTo(0.05);
  });
});

describe("postExcerpt", () => {
  it("returns a short post whole", () => {
    expect(postExcerpt("short post", ["Acme"])).toBe("short post");
  });

  it("keeps the opening, the ending, and a name deep inside a long post", () => {
    const body = `START ${"a ".repeat(1500)}we tried Shop Monkey here ${"b ".repeat(1500)}FINISH`;
    const excerpt = postExcerpt(body, ["Shopmonkey"]);

    expect(excerpt.length).toBeLessThanOrEqual(2020);
    expect(excerpt).toContain("START");
    expect(excerpt).toContain("Shop Monkey");
    expect(excerpt).toContain("FINISH");
  });

  it("stays within the limit when names repeat", () => {
    const body = `${"a ".repeat(600)}${"Acme and more text here ".repeat(400)}`;
    expect(postExcerpt(body, ["Acme"]).length).toBeLessThanOrEqual(2050);
  });
});

describe("urgency", () => {
  it("drops urgency when the post is not worth showing", () => {
    expect(urgencyWhenShown(false, 5)).toBeNull();
    expect(urgencyWhenShown(true, 4)).toBe(4);
  });
});

describe("missing brief", () => {
  it("asks for the company, what they sell, and what to find, and nothing else", () => {
    expect(missingBrief({ companyName: "", product: "chairs", buyer: "", keepWhen: "", notAbout: "" })).toEqual([
      "the company name",
      "what a post must show to be worth their time",
    ]);
  });

  it("is complete when the company, the product, and what to find are present", () => {
    expect(
      missingBrief({
        companyName: "Oak",
        product: "chairs",
        buyer: "",
        keepWhen: "someone is choosing a chair",
        notAbout: "",
      }),
    ).toEqual([]);
    expect(missingBrief({ companyName: "Oak", product: "chairs", buyer: "offices", keepWhen: "   ", notAbout: "car seats" })).toEqual([
      "what a post must show to be worth their time",
    ]);
  });

  it("keeps the buyer's words once the three required facts are set", () => {
    expect(cleanBrief({ companyName: "Oak", product: "home decor", buyer: "customers", keepWhen: "bad reviews of my product", notAbout: "" })).toMatchObject({
      buyer: "customers",
      keepWhen: "bad reviews of my product",
    });
    expect(missingBrief({ companyName: "Oak", product: "home decor", buyer: "customers", keepWhen: "bad reviews", notAbout: "" })).toEqual([]);
  });

  it("tells the model to judge clarity from what is already known", () => {
    const guidance = replyGuidance(
      { product: "home decor", keepWhen: "bad reviews of my product" },
    );
    expect(guidance).toContain("home decor");
    expect(guidance).toContain("bad reviews of my product");
    expect(guidance).toContain("specific enough to filter posts");
    expect(guidance).toContain("\"Nothing\"");
    expect(guidance).toContain("Do not recap");
  });

  it("keeps every brief fact in the summary, and a model note that adds to them", () => {
    const brief = { product: "home decor", buyer: "the general public", keepWhen: "bad reviews of my product", notAbout: "nothing in particular" };
    expect(chatSummary(brief)).toBe(
      "They sell home decor. Who buys it: the general public. They want found: bad reviews of my product. They want skipped: nothing in particular.",
    );
    expect(chatSummary(brief, "They sell home decor. Who buys it: the general public. They want found: bad reviews of my product. They want skipped: nothing in particular. They said almost anyone furnishes a home.")).toContain(
      "almost anyone furnishes a home",
    );
  });

  it("only blocks an empty starter field", () => {
    expect(starterIssue("my company")).toBeNull();
    expect(starterIssue("Oak")).toBeNull();
    expect(starterIssue("")).toMatch(/Add this/);
    expect(starterIssue("nothing")).toBeNull();
    expect(starterIssue("everything")).toBeNull();
  });

  it("treats a short no as nothing to skip, and keeps a real skip rule", () => {
    expect(declinesSkip("i don't think so any")).toBe(true);
    expect(declinesSkip("nothing")).toBe(true);
    expect(declinesSkip("skip posts about DIY tutorials")).toBe(false);
  });
});
