import { describe, it, expect } from "vitest";

interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface JevScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
}

interface JevNoulAnswer {
  type: "noul";
  noul: number;
}

interface JevResponse {
  answers: {
    is_relevant: JevNoulAnswer;
    category: JevChoiceAnswer;
    sentiment: JevChoiceAnswer;
    urgency: JevScoreAnswer;
  };
}

interface ClassificationResult {
  isRelevant: boolean;
  relevanceScore: number;
  category: string;
  categoryConfidence: number;
  sentiment: string;
  sentimentConfidence: number;
  urgency: number;
  urgencyRaw: number;
}

const RELEVANCE_THRESHOLD = 0.6;

function parseJevClassification(
  response: JevResponse,
  threshold = RELEVANCE_THRESHOLD,
): ClassificationResult {
  const answers = response.answers;
  const urgencyRaw = answers.urgency.score;
  const urgencyNormalized = Math.min(5, Math.max(1, Math.round(urgencyRaw) + 1));

  return {
    isRelevant: answers.is_relevant.noul > threshold,
    relevanceScore: answers.is_relevant.noul,
    category: answers.category.choice,
    categoryConfidence: answers.category.confidence,
    sentiment: answers.sentiment.choice,
    sentimentConfidence: answers.sentiment.confidence,
    urgency: urgencyNormalized,
    urgencyRaw,
  };
}

function createMockJevResponse(
  overrides: Partial<{
    relevance: number;
    category: string;
    categoryConfidence: number;
    sentiment: string;
    sentimentConfidence: number;
    urgencyScore: number;
    urgencyConfidence: number;
  }> = {},
): JevResponse {
  return {
    answers: {
      is_relevant: { type: "noul", noul: overrides.relevance ?? 0.85 },
      category: {
        type: "choice",
        choice: overrides.category ?? "complaint",
        confidence: overrides.categoryConfidence ?? 0.9,
        probabilities: { [overrides.category ?? "complaint"]: 0.9, other: 0.1 },
      },
      sentiment: {
        type: "choice",
        choice: overrides.sentiment ?? "negative",
        confidence: overrides.sentimentConfidence ?? 0.8,
        probabilities: { [overrides.sentiment ?? "negative"]: 0.8, neutral: 0.2 },
      },
      urgency: {
        type: "score",
        score: overrides.urgencyScore ?? 2.5,
        confidence: overrides.urgencyConfidence ?? 0.7,
        probabilities: { "0": 0, "1": 0.05, "2": 0.4, "3": 0.5, "4": 0.05 },
      },
    },
  };
}

describe("Jev Output Parsing", () => {
  it("should correctly parse a standard Jev classification response", () => {
    const response = createMockJevResponse();
    const result = parseJevClassification(response);

    expect(result.isRelevant).toBe(true);
    expect(result.relevanceScore).toBe(0.85);
    expect(result.category).toBe("complaint");
    expect(result.sentiment).toBe("negative");
  });

  it("should mark posts as relevant when noul > threshold", () => {
    const response = createMockJevResponse({ relevance: 0.75 });
    const result = parseJevClassification(response);
    expect(result.isRelevant).toBe(true);
  });

  it("should mark posts as irrelevant when noul <= threshold", () => {
    const response = createMockJevResponse({ relevance: 0.3 });
    const result = parseJevClassification(response);
    expect(result.isRelevant).toBe(false);
  });

  it("should handle boundary case at exactly the threshold", () => {
    const response = createMockJevResponse({ relevance: 0.6 });
    const result = parseJevClassification(response);
    expect(result.isRelevant).toBe(false); // > not >=
  });

  it("should correctly normalize urgency score from 0-4 to 1-5", () => {
    const cases = [
      { input: 0.0, expected: 1 },
      { input: 0.4, expected: 1 },
      { input: 0.5, expected: 2 },
      { input: 1.0, expected: 2 },
      { input: 1.5, expected: 3 },
      { input: 2.0, expected: 3 },
      { input: 2.5, expected: 4 },
      { input: 3.0, expected: 4 },
      { input: 3.5, expected: 5 },
      { input: 4.0, expected: 5 },
    ];

    for (const { input, expected } of cases) {
      const response = createMockJevResponse({ urgencyScore: input });
      const result = parseJevClassification(response);
      expect(result.urgency).toBe(expected);
    }
  });

  it("should clamp urgency to 1-5 range even with edge values", () => {
    const lowResponse = createMockJevResponse({ urgencyScore: -1 });
    expect(parseJevClassification(lowResponse).urgency).toBe(1);

    const highResponse = createMockJevResponse({ urgencyScore: 10 });
    expect(parseJevClassification(highResponse).urgency).toBe(5);
  });

  it("should handle all 6 category types", () => {
    const categories = [
      "complaint",
      "bug_report",
      "product_idea",
      "praise",
      "recommendation_ask",
      "other",
    ];
    for (const cat of categories) {
      const response = createMockJevResponse({ category: cat });
      const result = parseJevClassification(response);
      expect(result.category).toBe(cat);
    }
  });

  it("should handle all 3 sentiment types", () => {
    for (const sentiment of ["positive", "negative", "neutral"]) {
      const response = createMockJevResponse({ sentiment });
      const result = parseJevClassification(response);
      expect(result.sentiment).toBe(sentiment);
    }
  });

  it("should preserve confidence scores", () => {
    const response = createMockJevResponse({
      categoryConfidence: 0.42,
      sentimentConfidence: 0.76,
    });
    const result = parseJevClassification(response);
    expect(result.categoryConfidence).toBe(0.42);
    expect(result.sentimentConfidence).toBe(0.76);
  });

  it("should preserve raw urgency score alongside normalized", () => {
    const response = createMockJevResponse({ urgencyScore: 2.73 });
    const result = parseJevClassification(response);
    expect(result.urgencyRaw).toBe(2.73);
    expect(result.urgency).toBe(4); // round(2.73) + 1 = 4
  });

  it("should allow custom relevance threshold", () => {
    const response = createMockJevResponse({ relevance: 0.5 });

    const strictResult = parseJevClassification(response, 0.7);
    expect(strictResult.isRelevant).toBe(false);

    const lenientResult = parseJevClassification(response, 0.3);
    expect(lenientResult.isRelevant).toBe(true);
  });
});
