import { beforeEach, describe, expect, it, vi } from "vitest";

/** Runs the real classifier code. Only the Jev network call is replaced. */
const systemOne = vi.hoisted(() => vi.fn());

vi.mock("@typesafe-ai/sdk", () => ({
  TypeSafeClient: class {
    systemOne = systemOne;
  },
  noul: (instructions: string) => ({ type: "noul", instructions }),
  choice: (instructions: string, criteria: Record<string, string>) => ({ type: "choice", instructions, criteria }),
  score: (instructions: string, criteria: string[]) => ({ type: "score", instructions, criteria }),
}));

import { classifyPost, readGoals } from "@/server/services/classifier";
import { CATEGORIES } from "@/lib/types";

const brief = {
  product: "auto repair shop software",
  buyer: "",
  keepWhen: "people choosing or complaining about shop software",
  notAbout: "car owners asking about repairs",
};

const keywords = [
  { type: "brand", value: "AutoLeap", aliases: '["Auto Leap"]' },
  { type: "competitor", value: "Mitchell1", aliases: '["Mitchell 1"]' },
];

const input = {
  title: "Mitchell1",
  body: "My family owns a chain and each shop has its own Mitchell 1 license.",
  subreddit: "MechanicAdvice",
  companyName: "AutoLeap",
  keywords,
  brief,
};

function answers(overrides: Record<string, unknown> = {}) {
  return {
    about_brand: { noul: 0.05 },
    about_competitor: { noul: 0.05 },
    about_market: { noul: 0.9 },
    buying_intent: { noul: 0.9 },
    matches_request: { noul: 0.9 },
    excluded: { noul: 0.05 },
    promotional: { noul: 0.05 },
    category: { choice: "complaint", confidence: 0.8 },
    sentiment: { choice: "negative", confidence: 0.7 },
    urgency: { score: 2.4 },
    audience: { choice: "competitor_customer" },
    ...overrides,
  };
}

function sentRequest() {
  return systemOne.mock.calls[0]![0] as {
    state: string;
    questions: Record<string, { type: string; instructions: string; criteria?: unknown }>;
  };
}

beforeEach(() => {
  systemOne.mockReset();
  systemOne.mockResolvedValue({ answers: answers() });
});

describe("what is sent to Jev", () => {
  it("asks one question per rule in a single call", async () => {
    await classifyPost(input);

    expect(systemOne).toHaveBeenCalledTimes(1);
    expect(Object.keys(sentRequest().questions).sort()).toEqual([
      "about_brand",
      "about_competitor",
      "about_market",
      "audience",
      "buying_intent",
      "category",
      "competitor_market",
      "excluded",
      "matches_request",
      "promotional",
      "sentiment",
      "urgency",
    ]);
  });

  it("does not ask a question from the buyer text", async () => {
    await classifyPost({ ...input, brief: { ...brief, buyer: "autoleap owners" } });
    expect(JSON.stringify(sentRequest().questions)).not.toContain("autoleap owners");
  });

  it("names the competitors when asking who the author is", async () => {
    await classifyPost(input);
    expect(JSON.stringify(sentRequest().questions.audience!.criteria)).toContain("Mitchell1");
  });

  it("gives the state the post and its signals, not the brief or the search", async () => {
    await classifyPost({
      ...input,
      numComments: 39,
      redditScore: 4,
      postedAt: new Date(Date.now() - 5 * 3_600_000),
    });

    const { state } = sentRequest();
    expect(state).toContain("Comments: 39");
    expect(state).toContain("Votes: 4");
    expect(state).toContain("Posted: 5 hours ago");
    expect(state).not.toContain("Worth showing");
    expect(state).not.toContain("Keyword that matched");
  });

  it("offers exactly the six required categories", async () => {
    await classifyPost(input);
    expect(Object.keys(sentRequest().questions.category!.criteria as object).sort()).toEqual(
      [...CATEGORIES].sort(),
    );
  });

  it("has five urgency levels, and none of them repeats the relevance check", async () => {
    await classifyPost(input);
    const levels = sentRequest().questions.urgency!.criteria as string[];
    expect(levels).toHaveLength(5);
    expect(levels.join(" ")).not.toMatch(/what they asked for/i);
  });
});

describe("relevance outcome", () => {
  it("keeps a clear lead even when the free-text request scores it low", async () => {
    systemOne.mockResolvedValue({
      answers: answers({ about_market: { noul: 0.8 }, matches_request: { noul: 0.26 } }),
    });
    const result = await classifyPost(input);
    expect(result).toMatchObject({ isRelevant: true, relevanceScore: 0.8 });
  });

  it("keeps an unsure post so a person can review it", async () => {
    systemOne.mockResolvedValue({ answers: answers({ about_market: { noul: 0.58 } }) });
    const result = await classifyPost(input);
    expect(result).toMatchObject({ isRelevant: true, relevanceScore: 0.58, urgency: 3 });
  });

  it("drops a clearly low post and gives it no urgency", async () => {
    systemOne.mockResolvedValue({ answers: answers({ about_market: { noul: 0.1 } }) });
    expect(await classifyPost(input)).toMatchObject({ isRelevant: false, urgency: null });
  });

  it("drops a post from someone promoting their own product", async () => {
    systemOne.mockResolvedValue({ answers: answers({ promotional: { noul: 0.95 } }) });
    expect((await classifyPost(input)).isRelevant).toBe(false);
  });

  it("keeps a potential client who names nobody", async () => {
    systemOne.mockResolvedValue({
      answers: answers({ audience: { choice: "potential_customer" } }),
    });
    expect(await classifyPost({ ...input, title: "What software should I use?", body: "" })).toMatchObject({
      isRelevant: true,
      audienceTag: "potential_customer",
    });
  });
});

describe("a session looking for reviews of its own product", () => {
  const ownOnly = {
    ...input,
    goals: ["own_feedback" as const],
    brief: { ...brief, keepWhen: "Complaints, bugs and reviews" },
  };

  it("does not ask about the market or competitors", async () => {
    systemOne.mockResolvedValue({ answers: answers({ about_brand: { noul: 0.9 } }) });
    await classifyPost(ownOnly);

    const asked = Object.keys(sentRequest().questions);
    expect(asked).toContain("about_brand");
    expect(asked).not.toContain("about_market");
    expect(asked).not.toContain("about_competitor");
  });

  it("drops a generic complaint that has no link to the brand", async () => {
    // The real case: "No training on software" scored 0.87 for fitting the market.
    systemOne.mockResolvedValue({ answers: answers({ about_brand: { noul: 0.03 } }) });
    expect(await classifyPost(ownOnly)).toMatchObject({ isRelevant: false, relevanceScore: 0.03, urgency: null });
  });

  it("keeps a real complaint about the brand", async () => {
    systemOne.mockResolvedValue({ answers: answers({ about_brand: { noul: 0.96 } }) });
    expect(await classifyPost(ownOnly)).toMatchObject({ isRelevant: true, relevanceScore: 0.95 });
  });
});

describe("readGoals", () => {
  const request = { companyName: "QuickBooks", product: "accounting software", keepWhen: "Complaints, bugs and reviews" };
  const goalAnswers = (own: number, rivals: number, clients: number) => ({
    answers: {
      own_feedback: { noul: own },
      competitor_feedback: { noul: rivals },
      potential_clients: { noul: clients },
    },
  });

  it("keeps only the goals Jev finds in the request", async () => {
    systemOne.mockResolvedValue(goalAnswers(0.9, 0.1, 0.2));
    expect(await readGoals(request)).toEqual(["own_feedback"]);
  });

  it("keeps every goal the request names", async () => {
    systemOne.mockResolvedValue(goalAnswers(0.8, 0.1, 0.9));
    expect(await readGoals(request)).toEqual(["own_feedback", "potential_clients"]);
  });

  it("looks for everything when no goal is clear", async () => {
    systemOne.mockResolvedValue(goalAnswers(0.1, 0.1, 0.1));
    expect(await readGoals(request)).toEqual(["own_feedback", "competitor_feedback", "potential_clients"]);
  });

  it("looks for everything when Jev cannot be reached", async () => {
    systemOne.mockRejectedValue(new Error("down"));
    expect(await readGoals(request)).toEqual(["own_feedback", "competitor_feedback", "potential_clients"]);
  });
});

describe("urgency mapping", () => {
  it.each([
    [0, 1],
    [1.4, 2],
    [2.5, 4],
    [4, 5],
    [9, 5],
    [-1, 1],
  ])("maps a raw score of %s to %s", async (raw, expected) => {
    systemOne.mockResolvedValue({ answers: answers({ urgency: { score: raw } }) });
    const result = await classifyPost(input);
    expect(result.urgency).toBe(expected);
    expect(result.urgencyRaw).toBe(raw);
  });
});

describe("author type", () => {
  it.each(["customer", "competitor_customer", "potential_customer", "former_customer", "unrelated"])(
    "passes %s through",
    async (type) => {
      systemOne.mockResolvedValue({ answers: answers({ audience: { choice: type } }) });
      expect((await classifyPost(input)).audienceTag).toBe(type);
    },
  );
});

describe("the review record", () => {
  it("keeps every statement and raw answer", async () => {
    const result = await classifyPost(input);
    expect(result.trace?.claim).toContain("auto repair shop software");
    expect(result.trace?.answers).toMatchObject({ audience: { choice: "competitor_customer" } });
    expect(result.relevanceScores).toMatchObject({ about_market: 0.9, excluded: 0.05 });
  });
});
