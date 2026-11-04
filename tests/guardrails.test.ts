import { describe, it, expect } from "vitest";
import { z } from "zod";

// Test the Zod schema validation that runs on GPT-4o output
const ExtractionOutputSchema = z.object({
  config: z
    .object({
      companyName: z.string().max(100),
      brandKeywords: z
        .array(
          z.object({
            value: z.string().max(100),
            aliases: z.array(z.string().max(50)).max(10),
          }),
        )
        .max(5),
      competitorKeywords: z
        .array(z.object({ value: z.string().max(100) }))
        .max(10),
      topicKeywords: z
        .array(z.object({ value: z.string().max(200) }))
        .max(15),
      focusAreas: z.array(z.string().max(200)).max(10),
    })
    .optional(),
  conversationalReply: z.string().max(2000),
  needsClarification: z.boolean(),
  followUpQuestions: z.array(z.string().max(300)).max(5),
  isConfirmation: z.boolean(),
});

describe("Extraction Output Validation (Zod)", () => {
  it("should accept valid extraction output", () => {
    const validOutput = {
      config: {
        companyName: "QuickBooks",
        brandKeywords: [
          { value: "QuickBooks", aliases: ["QB", "QBO"] },
        ],
        competitorKeywords: [{ value: "FreshBooks" }],
        topicKeywords: [
          { value: "accounting software for freelancers" },
        ],
        focusAreas: ["invoicing"],
      },
      conversationalReply: "Here's what I found!",
      needsClarification: false,
      followUpQuestions: [],
      isConfirmation: false,
    };

    const result = ExtractionOutputSchema.safeParse(validOutput);
    expect(result.success).toBe(true);
  });

  it("should reject output with company name too long", () => {
    const result = ExtractionOutputSchema.safeParse({
      config: {
        companyName: "A".repeat(101),
        brandKeywords: [],
        competitorKeywords: [],
        topicKeywords: [],
        focusAreas: [],
      },
      conversationalReply: "Test",
      needsClarification: false,
      followUpQuestions: [],
      isConfirmation: false,
    });
    expect(result.success).toBe(false);
  });

  it("should reject output with too many brand keywords", () => {
    const result = ExtractionOutputSchema.safeParse({
      config: {
        companyName: "Test",
        brandKeywords: Array.from({ length: 6 }, (_, i) => ({
          value: `Brand${i}`,
          aliases: [],
        })),
        competitorKeywords: [],
        topicKeywords: [],
        focusAreas: [],
      },
      conversationalReply: "Test",
      needsClarification: false,
      followUpQuestions: [],
      isConfirmation: false,
    });
    expect(result.success).toBe(false);
  });

  it("should reject output with too many aliases per keyword", () => {
    const result = ExtractionOutputSchema.safeParse({
      config: {
        companyName: "Test",
        brandKeywords: [
          {
            value: "Test",
            aliases: Array.from({ length: 11 }, (_, i) => `Alias${i}`),
          },
        ],
        competitorKeywords: [],
        topicKeywords: [],
        focusAreas: [],
      },
      conversationalReply: "Test",
      needsClarification: false,
      followUpQuestions: [],
      isConfirmation: false,
    });
    expect(result.success).toBe(false);
  });

  it("should accept output without config (clarification needed)", () => {
    const result = ExtractionOutputSchema.safeParse({
      conversationalReply: "Could you tell me more about your company?",
      needsClarification: true,
      followUpQuestions: ["What is your company name?"],
      isConfirmation: false,
    });
    expect(result.success).toBe(true);
  });

  it("should reject missing required fields", () => {
    const result = ExtractionOutputSchema.safeParse({
      conversationalReply: "Test",
      // Missing needsClarification, followUpQuestions, isConfirmation
    });
    expect(result.success).toBe(false);
  });

  it("should reject conversational reply exceeding max length", () => {
    const result = ExtractionOutputSchema.safeParse({
      conversationalReply: "A".repeat(2001),
      needsClarification: false,
      followUpQuestions: [],
      isConfirmation: false,
    });
    expect(result.success).toBe(false);
  });
});

describe("Input Validation", () => {
  function validateInput(input: string): { valid: boolean; error?: string } {
    if (input.length > 2000) return { valid: false, error: "Input too long" };
    if (input.trim().length < 5)
      return { valid: false, error: "Please provide more detail" };
    return { valid: true };
  }

  it("should accept valid input", () => {
    expect(validateInput("I want to monitor QuickBooks")).toEqual({ valid: true });
  });

  it("should reject empty input", () => {
    expect(validateInput("")).toEqual({
      valid: false,
      error: "Please provide more detail",
    });
  });

  it("should reject whitespace-only input", () => {
    expect(validateInput("    ")).toEqual({
      valid: false,
      error: "Please provide more detail",
    });
  });

  it("should reject very short input", () => {
    expect(validateInput("hi")).toEqual({
      valid: false,
      error: "Please provide more detail",
    });
  });

  it("should reject extremely long input", () => {
    expect(validateInput("A".repeat(2001))).toEqual({
      valid: false,
      error: "Input too long",
    });
  });

  it("should accept input at max length", () => {
    expect(validateInput("A".repeat(2000))).toEqual({ valid: true });
  });
});
