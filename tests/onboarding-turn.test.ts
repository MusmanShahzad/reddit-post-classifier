import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkModeration: vi.fn(),
  extractOnboardingConfig: vi.fn(),
  checkGuardrails: vi.fn(),
  suggestMarketNames: vi.fn(),
}));

vi.mock("@/server/services/openai", () => ({
  checkModeration: mocks.checkModeration,
  extractOnboardingConfig: mocks.extractOnboardingConfig,
  suggestMarketNames: mocks.suggestMarketNames,
}));
vi.mock("@/server/services/classifier", () => ({ checkGuardrails: mocks.checkGuardrails }));

import { answerTurn, type TurnEvent } from "@/server/services/onboarding-turn";

const config = {
  companyName: "Deskly",
  product: "standing desks",
  buyer: "",
  keepWhen: "bad reviews of our desks",
  notAbout: "",
  brandKeywords: [{ value: "Deskly", aliases: [] }],
  competitorKeywords: [],
  topicKeywords: [{ value: "standing desk review" }],
  focusAreas: [],
};

async function run(message = "We sell standing desks and want bad reviews") {
  const events: TurnEvent[] = [];
  const result = await answerTurn({ message, conversationHistory: [] }, (event) => events.push(event));
  return { events, result };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkModeration.mockResolvedValue({ flagged: false });
  mocks.checkGuardrails.mockResolvedValue({ passed: true });
  mocks.suggestMarketNames.mockResolvedValue({ competitors: [], brandAliases: [] });
  mocks.extractOnboardingConfig.mockImplementation(
    async (_history: unknown, _message: string, options: { onReply?: (text: string) => void }) => {
      options.onReply?.("Got it.");
      options.onReply?.("Got it. Who buys them?");
      return {
        conversationalReply: "Got it. Who buys them?",
        needsClarification: false,
        isConfirmation: false,
        followUpQuestions: [],
        config,
      };
    },
  );
});

describe("filling in competitors", () => {
  const extraction = (overrides: Record<string, unknown> = {}, reply: Record<string, unknown> = {}) => ({
    conversationalReply: "Ready.",
    needsClarification: false,
    isConfirmation: false,
    followUpQuestions: [],
    config: { ...config, brandKeywords: [{ value: "Deskly", aliases: [] }], ...overrides },
    ...reply,
  });

  it("looks them up when the setup step returns none", async () => {
    mocks.extractOnboardingConfig.mockResolvedValue(extraction());
    mocks.suggestMarketNames.mockResolvedValue({
      competitors: [
        { value: "Uplift", aliases: ["Uplift Desk"] },
        { value: "deskly", aliases: [] },
      ],
      brandAliases: ["Desk ly", "deskly"],
    });

    const { result } = await run();

    expect(result.config?.competitorKeywords).toEqual([{ value: "Uplift", aliases: ["Uplift Desk"] }]);
    expect(result.config?.brandKeywords[0]?.aliases).toEqual(["Desk ly"]);
  });

  it("never replaces names already there", async () => {
    mocks.extractOnboardingConfig.mockResolvedValue(
      extraction({
        competitorKeywords: [{ value: "Fully" }],
        brandKeywords: [{ value: "Deskly", aliases: ["Desk ly"] }],
      }),
    );

    const { result } = await run();

    expect(mocks.suggestMarketNames).not.toHaveBeenCalled();
    expect(result.config?.competitorKeywords).toEqual([{ value: "Fully" }]);
  });

  it("makes no lookup while a required answer is still unclear", async () => {
    mocks.extractOnboardingConfig.mockResolvedValue(extraction({}, { needsClarification: true }));
    await run();
    expect(mocks.suggestMarketNames).not.toHaveBeenCalled();
  });

  it("still finishes the setup when nothing is found", async () => {
    mocks.extractOnboardingConfig.mockResolvedValue(extraction());
    const { result } = await run();
    expect(result.phase).toBe("confirming");
    expect(result.config?.competitorKeywords).toEqual([]);
  });
});

describe("answerTurn", () => {
  it("reports each step as it starts and ends, in order", async () => {
    const { events } = await run();
    const steps = events.flatMap((e) => (e.type === "step" ? [`${e.step.id}:${e.step.status}`] : []));
    expect(steps).toEqual([
      "validation:running",
      "validation:done",
      "moderation:running",
      "moderation:done",
      "guardrails:running",
      "guardrails:done",
      "extraction:running",
      "extraction:done",
    ]);
  });

  it("streams the reply as it is written, then the final reply with what is missing", async () => {
    const { events, result } = await run();
    const replies = events.flatMap((e) => (e.type === "reply" ? [e.text] : []));
    expect(replies.slice(0, 2)).toEqual(["Got it.", "Got it. Who buys them?"]);
    expect(replies.at(-1)).toBe(result.reply);
    expect(result.reply).toBe("That's enough to set this up. Check the details below and change anything you want.");
    expect(result.phase).toBe("confirming");
  });

  it("says in plain words what it understood and what is still missing", async () => {
    const { events } = await run();
    const activity = events.flatMap((e) => (e.type === "activity" ? [e.text] : []));
    expect(activity).toContain("Company: Deskly");
    expect(activity).toContain("They sell: standing desks");
    expect(activity).toContain("Find: bad reviews of our desks");
    expect(activity.some((line) => line.startsWith("Still need"))).toBe(false);
  });

  it("stops at the business check and never calls GPT-4o", async () => {
    mocks.checkGuardrails.mockResolvedValue({ passed: false, reason: "We can only monitor businesses." });
    const { events, result } = await run("Track my neighbour John every day");

    expect(mocks.extractOnboardingConfig).not.toHaveBeenCalled();
    expect(result.reply).toBe("We can only monitor businesses.");
    expect(result.pipelineSteps.find((s) => s.id === "guardrails")?.status).toBe("error");
    expect(result.pipelineSteps.find((s) => s.id === "extraction")?.status).toBe("skipped");
    expect(events.at(-1)).toEqual({ type: "reply", text: "We can only monitor businesses." });
  });

  it("keeps earlier answers and asks only for what this message left open", async () => {
    mocks.extractOnboardingConfig.mockResolvedValue({
      conversationalReply: "Noted.",
      needsClarification: false,
      isConfirmation: false,
      followUpQuestions: [],
      config: { ...config, product: "", keepWhen: "", buyer: "homeowners" },
    });
    const result = await answerTurn(
      {
        message: "Homeowners buy them",
        conversationHistory: [],
        known: { product: "home decor", keepWhen: "bad reviews of my product", buyer: "" },
      },
      () => undefined,
    );
    expect(result.config).toMatchObject({
      product: "home decor",
      buyer: "homeowners",
      keepWhen: "bad reviews of my product",
    });
    expect(result.reply).toBe("That's enough to set this up. Check the details below and change anything you want.");
    expect(result.phase).toBe("confirming");
    const guidance = mocks.extractOnboardingConfig.mock.calls[0]?.[2] as { guidance?: string };
    expect(guidance.guidance).toContain("home decor");
    expect(guidance.guidance).toContain("bad reviews of my product");
    expect(guidance.guidance).toContain("Do not recap");
  });

  it("asks the model's question when the model says the answer is unclear", async () => {
    mocks.extractOnboardingConfig.mockResolvedValue({
      conversationalReply: "Which posts should I keep for the home decor?",
      needsClarification: true,
      isConfirmation: false,
      followUpQuestions: [],
      config: { ...config, product: "home decor", keepWhen: "everything", buyer: "customers" },
    });
    const result = await answerTurn(
      {
        message: "everything",
        conversationHistory: [],
        known: { product: "home decor", keepWhen: "bad reviews of my product" },
      },
      () => undefined,
    );
    expect(result.phase).toBe("clarifying");
    expect(result.reply).toBe("Which posts should I keep for the home decor?");
    expect(result.config?.keepWhen).toBe("everything");
    const guidance = mocks.extractOnboardingConfig.mock.calls[0]?.[2] as { guidance?: string };
    expect(guidance.guidance).toContain("specific enough to filter");
  });

  it("stops asking once all four answers are in and offers the setup for review", async () => {
    mocks.extractOnboardingConfig.mockResolvedValue({
      conversationalReply: "Anything else?",
      needsClarification: false,
      isConfirmation: false,
      followUpQuestions: [],
      config: { ...config, buyer: "homeowners", notAbout: "DIY craft tutorials" },
    });
    const result = await answerTurn({ message: "Skip DIY craft tutorials", conversationHistory: [] }, () => undefined);
    expect(result.phase).toBe("confirming");
    expect(result.reply).toBe("That's enough to set this up. Check the details below and change anything you want.");
  });

  it("asks the model's question when nothing is not specific enough", async () => {
    mocks.extractOnboardingConfig.mockResolvedValueOnce({
      conversationalReply: "What does Wild Palace sell?",
      needsClarification: true,
      isConfirmation: false,
      followUpQuestions: [],
      config: { ...config, companyName: "Wild Palace", product: "", keepWhen: "" },
    });
    const accepted = await answerTurn({ message: "Wild Palace sells nothing. Find nothing.", conversationHistory: [] }, () => undefined);
    expect(accepted.phase).toBe("clarifying");
    expect(accepted.reply).toBe("What does Wild Palace sell?");
    expect(accepted.config).toMatchObject({ product: "", keepWhen: "" });

    mocks.extractOnboardingConfig.mockResolvedValueOnce({
      conversationalReply: "What kind of posts should I keep?",
      needsClarification: true,
      isConfirmation: false,
      followUpQuestions: [],
      config: { ...config, companyName: "Wild Palace", product: "home decor", keepWhen: "everything" },
    });
    const unclear = await answerTurn({ message: "Find everything", conversationHistory: [] }, () => undefined);
    expect(unclear.phase).toBe("clarifying");
    expect(unclear.reply).toBe("What kind of posts should I keep?");
    expect(unclear.config?.keepWhen).toBe("everything");
  });

  it("keeps the competitors the model names, without the company itself or repeats", async () => {
    mocks.extractOnboardingConfig.mockResolvedValue({
      conversationalReply: "ok",
      needsClarification: false,
      isConfirmation: false,
      followUpQuestions: [],
      config: {
        ...config,
        product: "home decor",
        keepWhen: "bad reviews of my product",
        competitorKeywords: [{ value: "Wayfair" }, { value: " wayfair " }, { value: config.companyName }, { value: "" }, { value: "IKEA" }],
      },
    });
    const result = await answerTurn({ message: "Find bad reviews of my product", conversationHistory: [] }, () => undefined);
    expect(result.phase).toBe("confirming");
    expect(result.config?.competitorKeywords).toEqual([{ value: "Wayfair" }, { value: "IKEA" }]);
  });

  it("reads a short reply as part of the chat instead of asking for the business again", async () => {
    mocks.checkGuardrails.mockResolvedValue({
      passed: false,
      reason: "Please describe a business, product, or brand you'd like to monitor.",
      scores: { isAboutBusiness: 0.05, targetsIndividual: 0.04 },
    });
    mocks.extractOnboardingConfig.mockResolvedValue({
      conversationalReply: "Nothing to skip. Does this setup look right?",
      needsClarification: false,
      isConfirmation: false,
      followUpQuestions: [],
      config: { ...config, product: "", buyer: "", keepWhen: "", notAbout: "" },
    });

    const result = await answerTurn(
      {
        message: "i don't think so any",
        conversationHistory: [
          { role: "user", content: "Find bad reviews of my product. We sell home decor" },
          { role: "assistant", content: "Any topics that should be skipped?" },
        ],
        known: { product: "home decor", keepWhen: "bad reviews of my product", buyer: "the general public" },
      },
      () => undefined,
    );

    expect(mocks.extractOnboardingConfig).toHaveBeenCalled();
    expect(mocks.checkGuardrails.mock.calls[0]?.[1]).toContain("home decor");
    expect(mocks.checkGuardrails.mock.calls[0]?.[1]).toContain("Find bad reviews of my product");
    expect(result.pipelineSteps.find((step) => step.id === "guardrails")?.status).toBe("done");
    expect(result.config).toMatchObject({
      product: "home decor",
      buyer: "the general public",
      keepWhen: "bad reviews of my product",
      notAbout: "nothing in particular",
    });
    expect(result.phase).toBe("confirming");
  });

  it("still stops a follow-up that asks to monitor a person", async () => {
    mocks.checkGuardrails.mockResolvedValue({
      passed: false,
      reason: "We can only monitor businesses and products, not individual people.",
      scores: { isAboutBusiness: 0.4, targetsIndividual: 0.91 },
    });
    const result = await answerTurn(
      {
        message: "Also track my neighbour John",
        conversationHistory: [{ role: "user", content: "We sell home decor" }],
        known: { product: "home decor", keepWhen: "bad reviews" },
      },
      () => undefined,
    );
    expect(mocks.extractOnboardingConfig).not.toHaveBeenCalled();
    expect(result.reply).toMatch(/individual people/);
  });

  it("passes the saved summary and only the latest turns once the chat is long", async () => {
    mocks.extractOnboardingConfig.mockResolvedValue({
      conversationalReply: "What should I skip?",
      needsClarification: true,
      isConfirmation: false,
      followUpQuestions: [],
      conversationSummary: "They sell home decor. They want found: bad reviews of my product. They said almost anyone buys it.",
      config: { ...config, product: "", keepWhen: "", buyer: "the general public" },
    });
    const history = Array.from({ length: 10 }, (_, index) => ({
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `turn ${index}`,
    }));
    const result = await answerTurn(
      {
        message: "the general public",
        conversationHistory: history,
        summary: "They sell home decor. They want found: bad reviews of my product.",
        known: { product: "home decor", keepWhen: "bad reviews of my product" },
      },
      () => undefined,
    );
    const [sentHistory, , options] = mocks.extractOnboardingConfig.mock.calls[0]!;
    expect(sentHistory).toHaveLength(4);
    expect(options.summary).toContain("home decor");
    expect(result.summary).toContain("home decor");
    expect(result.summary).toContain("bad reviews of my product");
  });

  it("turns a GPT failure into a friendly reply", async () => {
    mocks.extractOnboardingConfig.mockRejectedValue(new Error("429 rate limit"));
    const { result } = await run();
    expect(result.reply).toMatch(/trouble reading/);
    expect(result.pipelineSteps.find((s) => s.id === "extraction")).toMatchObject({
      status: "error",
      detail: "Rate limited — try again",
    });
  });
});
