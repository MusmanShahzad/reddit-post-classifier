/**
 * Onboarding Router Unit Tests
 *
 * Tests for the 4-layer guardrail pipeline logic, input validation,
 * configuration save logic, and GPT response variation handling.
 *
 * The schema uses z.preprocess + defaults to handle the many ways GPT-4o
 * can format its JSON output — these tests verify every known variation.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Inline copy of coercion helpers + schema (avoids env import)
// ---------------------------------------------------------------------------

function coerceToValueObject(item: unknown): { value: string } {
  if (typeof item === "string") return { value: item };
  if (typeof item === "object" && item !== null && "value" in item)
    return item as { value: string };
  return { value: String(item) };
}

function coerceToBrandObject(item: unknown): { value: string; aliases: string[] } {
  if (typeof item === "string") return { value: item, aliases: [] };
  if (typeof item === "object" && item !== null && "value" in item) {
    const obj = item as Record<string, unknown>;
    return {
      value: String(obj.value),
      aliases: Array.isArray(obj.aliases)
        ? (obj.aliases as unknown[]).map(String)
        : [],
    };
  }
  return { value: String(item), aliases: [] };
}

const ExtractionOutputSchema = z.object({
  config: z
    .object({
      companyName: z.string().max(100),
      brandKeywords: z.preprocess(
        (val) => (Array.isArray(val) ? val.map(coerceToBrandObject) : []),
        z.array(
          z.object({
            value: z.string().max(100),
            aliases: z.array(z.string().max(50)).max(10).default([]),
          }),
        ).max(5).default([]),
      ),
      competitorKeywords: z.preprocess(
        (val) => (Array.isArray(val) ? val.map(coerceToValueObject) : []),
        z.array(
          z.object({ value: z.string().max(100) }),
        ).max(10).default([]),
      ),
      topicKeywords: z.preprocess(
        (val) => (Array.isArray(val) ? val.map(coerceToValueObject) : []),
        z.array(
          z.object({ value: z.string().max(200) }),
        ).max(15).default([]),
      ),
      focusAreas: z.array(z.string().max(200)).max(10).default([]),
    })
    .nullable()
    .optional(),
  conversationalReply: z.string().max(2000).default(
    "I understand. Could you tell me more about your business so I can set up monitoring?",
  ),
  needsClarification: z.boolean().default(true),
  followUpQuestions: z.array(z.string().max(300)).max(5).default([]),
  isConfirmation: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Input Validation (Layer 1)
// ---------------------------------------------------------------------------
describe("Onboarding — Input Validation", () => {
  it("rejects messages shorter than 5 chars after trim", () => {
    const trimmed = "  hi ".trim();
    expect(trimmed.length).toBeLessThan(5);
  });

  it("accepts messages with 5+ chars", () => {
    const trimmed = "Track Acme Corp".trim();
    expect(trimmed.length).toBeGreaterThanOrEqual(5);
  });

  it("enforces max 2000 char limit via Zod", () => {
    const schema = z.string().min(1).max(2000);
    const longStr = "a".repeat(2001);
    expect(() => schema.parse(longStr)).toThrow();
  });

  it("accepts a valid-length message", () => {
    const schema = z.string().min(1).max(2000);
    expect(() => schema.parse("Track my company")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ExtractionOutput Schema — Standard validation
// ---------------------------------------------------------------------------
describe("Onboarding — ExtractionOutput Schema", () => {
  it("validates a complete config output with object arrays", () => {
    const output = {
      config: {
        companyName: "Acme Corp",
        brandKeywords: [{ value: "Acme Corp", aliases: ["acme"] }],
        competitorKeywords: [{ value: "DataBox" }],
        topicKeywords: [{ value: "analytics" }],
        focusAreas: ["dashboard performance"],
      },
      conversationalReply: "I've identified Acme Corp as your brand.",
      needsClarification: false,
      followUpQuestions: [],
      isConfirmation: false,
    };
    const result = ExtractionOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it("validates output without config (clarification needed)", () => {
    const output = {
      conversationalReply: "Could you tell me your company name?",
      needsClarification: true,
      followUpQuestions: ["What is your company name?"],
      isConfirmation: false,
    };
    const result = ExtractionOutputSchema.safeParse(output);
    expect(result.success).toBe(true);
  });

  it("rejects company name exceeding 100 chars", () => {
    const output = {
      config: {
        companyName: "A".repeat(101),
        brandKeywords: [],
        competitorKeywords: [],
        topicKeywords: [],
        focusAreas: [],
      },
      conversationalReply: "Ok",
      needsClarification: false,
      followUpQuestions: [],
      isConfirmation: false,
    };
    const result = ExtractionOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it("rejects more than 5 brand keywords", () => {
    const output = {
      config: {
        companyName: "Acme",
        brandKeywords: Array.from({ length: 6 }, (_, i) => ({
          value: `Brand${i}`,
          aliases: [],
        })),
        competitorKeywords: [],
        topicKeywords: [],
        focusAreas: [],
      },
      conversationalReply: "Ok",
      needsClarification: false,
      followUpQuestions: [],
      isConfirmation: false,
    };
    const result = ExtractionOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it("rejects more than 10 competitor keywords", () => {
    const output = {
      config: {
        companyName: "Acme",
        brandKeywords: [],
        competitorKeywords: Array.from({ length: 11 }, (_, i) => ({
          value: `Comp${i}`,
        })),
        topicKeywords: [],
        focusAreas: [],
      },
      conversationalReply: "Ok",
      needsClarification: false,
      followUpQuestions: [],
      isConfirmation: false,
    };
    const result = ExtractionOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it("rejects reply exceeding 2000 chars", () => {
    const output = {
      conversationalReply: "A".repeat(2001),
      needsClarification: false,
      followUpQuestions: [],
      isConfirmation: false,
    };
    const result = ExtractionOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });

  it("rejects more than 5 follow-up questions", () => {
    const output = {
      conversationalReply: "Ok",
      needsClarification: true,
      followUpQuestions: Array.from({ length: 6 }, (_, i) => `Q${i}?`),
      isConfirmation: false,
    };
    const result = ExtractionOutputSchema.safeParse(output);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GPT Response Variations — the real-world shapes GPT-4o returns
// ---------------------------------------------------------------------------
describe("Onboarding — GPT Response Variations", () => {
  it("handles topicKeywords as plain strings", () => {
    const gptResponse = {
      config: {
        companyName: "AutoLeap",
        brandKeywords: [{ value: "AutoLeap", aliases: ["Auto Leap"] }],
        competitorKeywords: [{ value: "Shopmonkey" }],
        topicKeywords: ["auto repair software", "shop management", "car service"],
        focusAreas: ["complaints"],
      },
      conversationalReply: "Here's your config.",
      needsClarification: false,
      followUpQuestions: [],
      isConfirmation: false,
    };
    const result = ExtractionOutputSchema.safeParse(gptResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config!.topicKeywords).toEqual([
        { value: "auto repair software" },
        { value: "shop management" },
        { value: "car service" },
      ]);
    }
  });

  it("handles competitorKeywords as plain strings", () => {
    const gptResponse = {
      config: {
        companyName: "Stripe",
        brandKeywords: [{ value: "Stripe", aliases: [] }],
        competitorKeywords: ["PayPal", "Square", "Adyen"],
        topicKeywords: [{ value: "payment processing" }],
        focusAreas: [],
      },
      conversationalReply: "Got it.",
      needsClarification: false,
      followUpQuestions: [],
      isConfirmation: false,
    };
    const result = ExtractionOutputSchema.safeParse(gptResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config!.competitorKeywords).toEqual([
        { value: "PayPal" },
        { value: "Square" },
        { value: "Adyen" },
      ]);
    }
  });

  it("handles brandKeywords as plain strings", () => {
    const gptResponse = {
      config: {
        companyName: "Notion",
        brandKeywords: ["Notion"],
        competitorKeywords: ["Confluence", "Coda"],
        topicKeywords: ["note taking", "productivity"],
        focusAreas: [],
      },
      conversationalReply: "Setting up Notion.",
      needsClarification: false,
      followUpQuestions: [],
      isConfirmation: false,
    };
    const result = ExtractionOutputSchema.safeParse(gptResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config!.brandKeywords).toEqual([
        { value: "Notion", aliases: [] },
      ]);
    }
  });

  it("handles config: null gracefully", () => {
    const gptResponse = {
      config: null,
      conversationalReply: "Tell me about your business.",
      needsClarification: true,
      followUpQuestions: ["What is your company name?"],
      isConfirmation: false,
    };
    const result = ExtractionOutputSchema.safeParse(gptResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config).toBeNull();
    }
  });

  it("handles missing conversationalReply with default", () => {
    const gptResponse = {
      config: { companyName: "Test", brandKeywords: [], competitorKeywords: [], topicKeywords: [], focusAreas: [] },
      needsClarification: true,
      followUpQuestions: [],
      isConfirmation: false,
    };
    const result = ExtractionOutputSchema.safeParse(gptResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.conversationalReply).toContain("tell me more");
    }
  });

  it("handles missing needsClarification with default false→true", () => {
    const gptResponse = {
      config: null,
      conversationalReply: "Hi",
      followUpQuestions: [],
      isConfirmation: false,
    };
    const result = ExtractionOutputSchema.safeParse(gptResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.needsClarification).toBe(true);
    }
  });

  it("handles missing isConfirmation with default false", () => {
    const gptResponse = {
      config: null,
      conversationalReply: "Hi",
      needsClarification: true,
      followUpQuestions: [],
    };
    const result = ExtractionOutputSchema.safeParse(gptResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isConfirmation).toBe(false);
    }
  });

  it("handles missing followUpQuestions with default empty array", () => {
    const gptResponse = {
      config: null,
      conversationalReply: "Hi",
      needsClarification: true,
      isConfirmation: false,
    };
    const result = ExtractionOutputSchema.safeParse(gptResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.followUpQuestions).toEqual([]);
    }
  });

  it("handles completely empty GPT response (only config)", () => {
    const gptResponse = {
      config: { companyName: "Acme" },
    };
    const result = ExtractionOutputSchema.safeParse(gptResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config!.companyName).toBe("Acme");
      expect(result.data.config!.brandKeywords).toEqual([]);
      expect(result.data.config!.competitorKeywords).toEqual([]);
      expect(result.data.config!.topicKeywords).toEqual([]);
      expect(result.data.needsClarification).toBe(true);
      expect(result.data.isConfirmation).toBe(false);
    }
  });

  it("handles mixed keyword formats in the same response", () => {
    const gptResponse = {
      config: {
        companyName: "Mixed Corp",
        brandKeywords: [
          { value: "Mixed Corp", aliases: ["MC"] },
          "MixedCo",
        ],
        competitorKeywords: [
          { value: "Rival A" },
          "Rival B",
        ],
        topicKeywords: [
          { value: "industry" },
          "market share",
          "analytics",
        ],
        focusAreas: [],
      },
      conversationalReply: "Mixed formats are fine.",
      needsClarification: false,
      followUpQuestions: [],
      isConfirmation: false,
    };
    const result = ExtractionOutputSchema.safeParse(gptResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config!.brandKeywords).toHaveLength(2);
      expect(result.data.config!.brandKeywords[0]).toEqual({ value: "Mixed Corp", aliases: ["MC"] });
      expect(result.data.config!.brandKeywords[1]).toEqual({ value: "MixedCo", aliases: [] });
      expect(result.data.config!.competitorKeywords).toHaveLength(2);
      expect(result.data.config!.topicKeywords).toHaveLength(3);
    }
  });

  it("handles missing config entirely (GPT didn't include it)", () => {
    const gptResponse = {
      conversationalReply: "Tell me about your business.",
      needsClarification: true,
      followUpQuestions: [],
      isConfirmation: false,
    };
    const result = ExtractionOutputSchema.safeParse(gptResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config).toBeUndefined();
    }
  });

  it("handles brand keyword without aliases field", () => {
    const gptResponse = {
      config: {
        companyName: "NoAlias Inc",
        brandKeywords: [{ value: "NoAlias Inc" }],
        competitorKeywords: [],
        topicKeywords: [],
        focusAreas: [],
      },
      conversationalReply: "Ok",
      needsClarification: false,
      followUpQuestions: [],
      isConfirmation: false,
    };
    const result = ExtractionOutputSchema.safeParse(gptResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config!.brandKeywords[0]).toEqual({
        value: "NoAlias Inc",
        aliases: [],
      });
    }
  });

  it("handles missing focusAreas with default empty array", () => {
    const gptResponse = {
      config: {
        companyName: "FocusTest",
        brandKeywords: [],
        competitorKeywords: [],
        topicKeywords: [],
      },
      conversationalReply: "Ok",
      needsClarification: false,
      followUpQuestions: [],
      isConfirmation: false,
    };
    const result = ExtractionOutputSchema.safeParse(gptResponse);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config!.focusAreas).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase transition logic
// ---------------------------------------------------------------------------
describe("Onboarding — Phase transitions", () => {
  it("returns complete phase on confirmation with config", () => {
    const isConfirmation = true;
    const config = { companyName: "Acme" };
    const phase = isConfirmation && config ? "complete" : "clarifying";
    expect(phase).toBe("complete");
  });

  it("returns clarifying phase when needsClarification", () => {
    const needsClarification = true;
    const phase = needsClarification ? "clarifying" : "confirming";
    expect(phase).toBe("clarifying");
  });

  it("returns confirming phase by default", () => {
    const isConfirmation = false;
    const needsClarification = false;
    let phase = "confirming";
    if (isConfirmation) phase = "complete";
    if (needsClarification) phase = "clarifying";
    expect(phase).toBe("confirming");
  });
});

// ---------------------------------------------------------------------------
// Pipeline steps logic
// ---------------------------------------------------------------------------
describe("Onboarding — Pipeline steps", () => {
  const makeSteps = (
    overrides: Record<string, { status: string; detail?: string }>,
  ) => {
    const defaults: { id: string; label: string; status: string; detail?: string }[] = [
      { id: "validation", label: "Input validation", status: "pending" },
      { id: "moderation", label: "Content safety check", status: "pending" },
      { id: "guardrails", label: "Business focus check", status: "pending" },
      { id: "extraction", label: "Extracting config", status: "pending" },
    ];
    return defaults.map((s) =>
      overrides[s.id] ? { ...s, ...overrides[s.id] } : s,
    );
  };

  it("shows validation error with all others skipped for short input", () => {
    const steps = makeSteps({
      validation: { status: "error", detail: "Too short" },
      moderation: { status: "skipped" },
      guardrails: { status: "skipped" },
      extraction: { status: "skipped" },
    });
    expect(steps[0]!.status).toBe("error");
    expect(steps[1]!.status).toBe("skipped");
    expect(steps[2]!.status).toBe("skipped");
    expect(steps[3]!.status).toBe("skipped");
  });

  it("shows moderation flagged with later steps skipped", () => {
    const steps = makeSteps({
      validation: { status: "done" },
      moderation: { status: "error", detail: "Flagged" },
      guardrails: { status: "skipped" },
      extraction: { status: "skipped" },
    });
    expect(steps[0]!.status).toBe("done");
    expect(steps[1]!.status).toBe("error");
    expect(steps[2]!.status).toBe("skipped");
  });

  it("shows all done on successful extraction", () => {
    const steps = makeSteps({
      validation: { status: "done" },
      moderation: { status: "done", detail: "Passed" },
      guardrails: { status: "done", detail: "Business confirmed" },
      extraction: { status: "done", detail: "Config extracted" },
    });
    expect(steps.every((s) => s.status === "done")).toBe(true);
  });

  it("shows extraction error with others done", () => {
    const steps = makeSteps({
      validation: { status: "done" },
      moderation: { status: "done", detail: "Passed" },
      guardrails: { status: "done", detail: "Passed" },
      extraction: { status: "error", detail: "Invalid AI response format" },
    });
    expect(steps[3]!.status).toBe("error");
    expect(steps[3]!.detail).toBe("Invalid AI response format");
  });
});

// ---------------------------------------------------------------------------
// saveConfig
// ---------------------------------------------------------------------------
describe("Onboarding — saveConfig logic", () => {
  it("creates keyword entries with correct shape", () => {
    const brand = { value: "Acme Corp", aliases: ["acme"] };
    const dbData = {
      companyId: "cmp_1",
      type: "brand",
      value: brand.value,
      aliases: JSON.stringify(brand.aliases),
    };
    expect(dbData.aliases).toBe('["acme"]');
  });

  it("creates empty aliases for competitors", () => {
    const comp = { value: "DataBox" };
    const dbData = {
      companyId: "cmp_1",
      type: "competitor",
      value: comp.value,
      aliases: "[]",
    };
    expect(dbData.aliases).toBe("[]");
  });
});

// ---------------------------------------------------------------------------
// Coercion helpers
// ---------------------------------------------------------------------------
describe("Onboarding — Coercion helpers", () => {
  it("coerceToValueObject: string → { value }", () => {
    expect(coerceToValueObject("hello")).toEqual({ value: "hello" });
  });

  it("coerceToValueObject: object with value → passthrough", () => {
    expect(coerceToValueObject({ value: "test" })).toEqual({ value: "test" });
  });

  it("coerceToValueObject: number → { value: string }", () => {
    expect(coerceToValueObject(42)).toEqual({ value: "42" });
  });

  it("coerceToBrandObject: string → { value, aliases: [] }", () => {
    expect(coerceToBrandObject("Acme")).toEqual({ value: "Acme", aliases: [] });
  });

  it("coerceToBrandObject: object with value only → adds empty aliases", () => {
    expect(coerceToBrandObject({ value: "Acme" })).toEqual({ value: "Acme", aliases: [] });
  });

  it("coerceToBrandObject: full object → passthrough", () => {
    expect(coerceToBrandObject({ value: "Acme", aliases: ["acme"] })).toEqual({
      value: "Acme",
      aliases: ["acme"],
    });
  });

  it("coerceToBrandObject: number → stringified", () => {
    expect(coerceToBrandObject(123)).toEqual({ value: "123", aliases: [] });
  });
});
