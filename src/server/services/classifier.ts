import { TypeSafeClient, choice, noul, score } from "@typesafe-ai/sdk";
import { env } from "~/env";

const client = new TypeSafeClient({
  apiKey: env.TYPESAFE_API_KEY,
  defaultModel: "jev-latest",
});

export interface ClassificationInput {
  title: string;
  body: string;
  subreddit: string;
  companyName: string;
  keywordTracked: string;
}

export interface ClassificationResult {
  isRelevant: boolean;
  relevanceScore: number;
  category: string;
  categoryConfidence: number;
  sentiment: string;
  sentimentConfidence: number;
  urgency: number;
  urgencyRaw: number;
}

export async function classifyPost(
  input: ClassificationInput,
): Promise<ClassificationResult> {
  const stateText = [
    `Subreddit: r/${input.subreddit}`,
    `Title: ${input.title}`,
    input.body ? `Body: ${input.body.slice(0, 2000)}` : "",
    `Company being monitored: ${input.companyName}`,
    `Keyword that matched: ${input.keywordTracked}`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await client.systemOne({
    state: stateText,
    questions: {
      is_relevant: noul(
        "This post is genuinely about or related to the monitored company/brand/topic, " +
          "not just a coincidental keyword match or unrelated discussion",
      ),
      category: choice("What type of post is this in relation to the monitored company?", {
        complaint:
          "User expressing dissatisfaction, frustration, or negative experience with the product/service",
        bug_report:
          "User reporting a specific technical issue, error, or malfunction",
        product_idea:
          "User suggesting a feature, improvement, or enhancement",
        praise:
          "User expressing satisfaction, recommending, or saying positive things",
        recommendation_ask:
          "User asking for suggestions, alternatives, comparisons, or recommendations in the product category",
        other:
          "Doesn't clearly fit any of the above categories",
      }),
      sentiment: choice("What is the overall sentiment of this post?", {
        positive: "Expressing satisfaction, gratitude, enthusiasm, or recommending",
        negative: "Expressing frustration, disappointment, criticism, or complaining",
        neutral: "Factual, balanced, asking a question, or neither clearly positive nor negative",
      }),
      urgency: score("How urgently should the company respond to this post?", [
        "No response needed — general chatter, already resolved, or not worth engaging",
        "Low priority — could respond but no pressure or time sensitivity",
        "Medium priority — user expects an answer or is comparing options",
        "High priority — user is frustrated, considering switching, or post has traction",
        "Critical — public complaint gaining visibility, data loss, or urgent service issue",
      ]),
    },
  });

  const answers = response.answers;
  const urgencyRaw = answers.urgency.score;
  const urgencyNormalized = Math.min(5, Math.max(1, Math.round(urgencyRaw) + 1));

  return {
    isRelevant: answers.is_relevant.noul > (env.RELEVANCE_THRESHOLD ?? 0.6),
    relevanceScore: answers.is_relevant.noul,
    category: answers.category.choice,
    categoryConfidence: answers.category.confidence,
    sentiment: answers.sentiment.choice,
    sentimentConfidence: answers.sentiment.confidence,
    urgency: urgencyNormalized,
    urgencyRaw,
  };
}

export interface GuardrailResult {
  passed: boolean;
  reason?: string;
  scores: {
    isAboutBusiness: number;
    targetsIndividual: number;
  };
}

export async function checkGuardrails(
  message: string,
): Promise<GuardrailResult> {
  const response = await client.systemOne({
    state: message,
    questions: {
      is_about_business: noul(
        "This message is about monitoring a business, company, brand, product, or service — " +
          "not an individual person",
      ),
      targets_individual: noul(
        "This message asks to track, monitor, stalk, or surveil a specific individual person " +
          "(not a company or brand)",
      ),
    },
  });

  const scores = {
    isAboutBusiness: response.answers.is_about_business.noul,
    targetsIndividual: response.answers.targets_individual.noul,
  };

  if (scores.targetsIndividual > 0.6) {
    return {
      passed: false,
      reason: "We can only monitor businesses and products, not individual people.",
      scores,
    };
  }

  if (scores.isAboutBusiness < 0.3) {
    return {
      passed: false,
      reason: "Please describe a business, product, or brand you'd like to monitor.",
      scores,
    };
  }

  return { passed: true, scores };
}
