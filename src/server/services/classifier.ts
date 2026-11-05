/**
 * TypeSafe AI (Jev) Classification Service
 *
 * Uses Jev — a deterministic "System One" model — for structured post
 * classification and onboarding guardrail checks.  Jev cannot hallucinate;
 * it returns typed probability distributions over developer-defined labels.
 *
 * - {@link classifyPost} — scores and labels a Reddit post in a single call.
 * - {@link readGoals} — reads what a session asked to find.
 * - {@link keepBuyerCommunities} — drops subreddits that clearly do not fit.
 * - {@link reasonIsBacked} — checks a summary line against its post.
 * - {@link checkGuardrails} — validates that a user message is a legitimate
 *   business-monitoring request (not targeting an individual).
 *
 * @module services/classifier
 */

import { TypeSafeClient, choice, noul, score } from "@typesafe-ai/sdk";
import { env } from "@/env";
import { aliasList, SKIP_AT } from "@/lib/filter-checks";
import { GOALS, type Goal } from "@/lib/goals";
import {
  combineRelevance,
  monitoringScope,
  postExcerpt,
  relevanceStatements,
  urgencyLevel,
  urgencyWhenShown,
  type ProductBrief,
  type RelevanceScores,
  type ScopeKeyword,
} from "@/lib/relevance";
import type { AudienceTag } from "@/lib/types";

const client = new TypeSafeClient({
  apiKey: env.TYPESAFE_API_KEY,
  defaultModel: "jev-latest",
});

/**
 * Whether the post backs up a summary line. If Jev cannot be reached, the free
 * checks in reason-checks have already run, so the line is kept.
 */
export async function reasonIsBacked(postText: string, line: string): Promise<boolean> {
  try {
    const response = await client.systemOne({
      state: `${postText}\n\nSummary line: ${line}`,
      questions: {
        backed: noul("Everything the summary line claims is stated in the post."),
      },
    });
    return response.answers.backed.noul >= 0.5;
  } catch (error) {
    console.warn(`Could not check a summary: ${error instanceof Error ? error.message : "Unknown"}`);
    return true;
  }
}

/**
 * Reads what the user asked to find. Jev scores each goal separately, so a
 * misspelled or loosely worded request still works. If the call fails or no
 * goal is clear, the session looks for everything.
 */
export async function readGoals(brief: {
  companyName: string;
  product: string;
  keepWhen: string;
}): Promise<Goal[]> {
  try {
    const response = await client.systemOne({
      state: `Company: ${brief.companyName}\nSells: ${brief.product}\nThey asked to find: ${brief.keepWhen}`,
      questions: {
        own_feedback: noul(
          "They want to hear what people say about their own company or product, such as reviews, complaints, bugs, or praise. A request for reviews or complaints with no other company named means their own.",
        ),
        competitor_feedback: noul(
          "They explicitly want to hear what people say about competing companies or products.",
        ),
        potential_clients: noul(
          "They want to find new customers, such as people looking for or choosing this kind of product.",
        ),
      },
    });
    const goals = GOALS.filter((goal) => response.answers[goal].noul >= 0.5);
    return goals.length > 0 ? goals : [...GOALS];
  } catch (error) {
    console.warn(`Could not read the goal: ${error instanceof Error ? error.message : "Unknown"}`);
    return [...GOALS];
  }
}

/** How many communities stay when Jev scores every one of them low. */
const MIN_COMMUNITIES = 3;

/** Input required to classify a single Reddit post. */
export interface ClassificationInput {
  /** Post title. */
  title: string;
  /** Post self-text body (may be empty for link posts). */
  body: string;
  /** Subreddit the post was found in (without `r/` prefix). */
  subreddit: string;
  /** Name of the company being monitored. */
  companyName: string;
  /** Number of comments on the post. */
  numComments?: number;
  /** Net votes on the post. */
  redditScore?: number;
  /** When the post was published. */
  postedAt?: Date;
  /** Brand, competitor, and topic keywords, with aliases stored as a JSON list. */
  keywords?: Array<ScopeKeyword & { aliases?: string }>;
  /** What this session looks for. Without it, a post can match any goal. */
  goals?: Goal[];
  /** What onboarding learned. The filter is written from this, not from a fixed industry. */
  brief?: Partial<ProductBrief> | null;
}

/** Result of a single post classification. */
export interface ClassificationResult {
  /** Whether the post is kept, either shown or held for review. */
  isRelevant: boolean;
  /** From {@link combineRelevance}, from 0 to 1. */
  relevanceScore: number;
  /** The score for each relevance rule. */
  relevanceScores: RelevanceScores;
  /** Winning category label. */
  category: string;
  /** Confidence of the chosen category (0–1). */
  categoryConfidence: number;
  /** Winning sentiment label. */
  sentiment: string;
  /** Confidence of the chosen sentiment (0–1). */
  sentimentConfidence: number;
  /** Normalised urgency (1–5), or null when the post is not worth showing. */
  urgency: number | null;
  /** Raw Jev score index (0-based). */
  urgencyRaw: number;
  /** How the author relates to the monitored company. */
  audienceTag: AudienceTag;
  /** What was scored and every raw answer, so a decision can be reviewed later. */
  trace?: ClassificationTrace;
}

export interface ClassificationTrace {
  claim: string;
  state: string;
  threshold: number;
  answers: unknown;
}

function postedAgo(postedAt: Date, now = Date.now()): string {
  const hours = Math.max(0, Math.round((now - postedAt.getTime()) / 3_600_000));
  return hours < 48 ? `${hours} hours ago` : `${Math.round(hours / 24)} days ago`;
}

/**
 * Classifies a Reddit post in a single Jev API call:
 *
 * 1. **Relevance** (`noul`) — one question per rule, combined in
 *    {@link combineRelevance}.
 * 2. **Category** (`choice`) — complaint / bug_report / product_idea / praise /
 *    recommendation_ask / other.
 * 3. **Sentiment** (`choice`) — positive / negative / neutral.
 * 4. **Urgency** (`score`) — 5 levels, each tied to something visible in the post.
 * 5. **Author** (`choice`) — how the author relates to the monitored company.
 *
 * The raw urgency index is normalised to a 1–5 integer via `round(raw) + 1`,
 * clamped to [1, 5].
 *
 * @param input - Post text and monitoring context.
 * @returns Structured classification result.
 *
 * @example
 * ```ts
 * const result = await classifyPost({
 *   title: "Acme dashboard keeps crashing",
 *   body: "Every time I load >10k rows …",
 *   subreddit: "SaaS",
 *   companyName: "Acme Corp",
 * });
 * // result.category === "complaint"
 * // result.urgency === 4
 * ```
 */
export async function classifyPost(
  input: ClassificationInput,
): Promise<ClassificationResult> {
  const keywords = input.keywords ?? [];
  const scope = monitoringScope(keywords);
  const aliasesOf = (type: string) =>
    keywords.filter((keyword) => keyword.type === type).flatMap((keyword) => aliasList(keyword.aliases));
  const brandAliases = aliasesOf("brand");
  const competitorAliases = aliasesOf("competitor");
  const excerpt = postExcerpt(input.body, [
    input.companyName,
    ...scope.brands,
    ...scope.competitors,
    ...brandAliases,
    ...competitorAliases,
  ]);

  // The post alone. Each rule from the brief is in its own question.
  const stateText = [
    `Subreddit: r/${input.subreddit}`,
    `Title: ${input.title}`,
    excerpt ? `Body: ${excerpt}` : "",
    input.numComments !== undefined ? `Comments: ${input.numComments}` : "",
    input.redditScore !== undefined ? `Votes: ${input.redditScore}` : "",
    input.postedAt ? `Posted: ${postedAgo(input.postedAt)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const statements = relevanceStatements({
    companyName: input.companyName,
    scope,
    goals: input.goals,
    brandAliases,
    competitorAliases,
    brief: input.brief,
  });
  const relevanceQuestions: Record<string, ReturnType<typeof noul>> = {};
  for (const [id, statement] of Object.entries(statements)) {
    relevanceQuestions[id] = noul(statement);
  }
  const rivals = scope.competitors.length > 0
    ? `another product of this kind, such as ${scope.competitors.join(", ")}`
    : "another product of this kind";

  const response = await client.systemOne({
    state: stateText,
    questions: {
      ...relevanceQuestions,
      category: choice("What is the author's main purpose in this post? Choose one by main purpose, even when the post also does something else.", {
        complaint:
          "Expressing dissatisfaction with a product's price, service, or overall experience, without describing a specific failure",
        bug_report:
          "Describing a specific error, malfunction, or thing that stopped working. Choose this over complaint when a specific failure is described, even if the author is angry",
        product_idea:
          "Suggesting or requesting a feature or improvement",
        praise:
          "Sharing a good experience with a product they have used",
        recommendation_ask:
          "Asking which product to choose, for alternatives, or for other people's experience before deciding. Choose this over complaint when an unhappy author mainly asks what to switch to",
        other:
          "None of the above is the main purpose",
      }),
      sentiment: choice("What is the overall sentiment of this post?", {
        positive: "Expressing satisfaction, gratitude, or enthusiasm",
        negative: "Expressing frustration, disappointment, or criticism",
        neutral: "Factual, balanced, asking a question, or neither clearly positive nor negative",
      }),
      urgency: score(
        "How soon should a team respond to this post? Use what the author says, the number of comments and votes, and how recently it was posted.",
        [
          "General discussion, with no decision or problem waiting on an answer",
          "An open question or a mild problem, with no sign of a deadline",
          "The author is actively choosing a product or is waiting for an answer now",
          "The author is cancelling, switching, or blocked by a problem that stops their work, or the thread is drawing many comments",
          "A response is needed today because of a safety risk, a legal threat, lost data, a billing dispute, or an outage affecting many people",
        ],
      ),
      audience: choice(
        `How does the author relate to ${input.companyName}?`,
        {
          customer:
            `They say they currently use, pay for, or work with ${input.companyName}`,
          competitor_customer:
            `They say they currently use ${rivals}. Choose this even when they are looking to switch`,
          potential_customer:
            "They are looking for a product of this kind and do not say they currently use one",
          former_customer:
            `They say they used ${input.companyName} in the past and stopped`,
          unrelated:
            "They are not a buyer or user of this kind of product, such as an employee, reporter, or bystander",
        },
      ),
    },
  });

  const answers = response.answers;
  const relevanceScores: RelevanceScores = {};
  for (const id of Object.keys(statements) as Array<keyof RelevanceScores>) {
    relevanceScores[id] = (answers as unknown as Record<string, { noul: number } | undefined>)[id]?.noul;
  }
  const relevanceScore = combineRelevance(relevanceScores);
  const urgencyRaw = answers.urgency.score;
  const urgencyNormalized = urgencyLevel(urgencyRaw);
  const threshold = env.RELEVANCE_THRESHOLD ?? 0.7;
  const isRelevant = relevanceScore > SKIP_AT;

  return {
    isRelevant,
    relevanceScore,
    relevanceScores,
    category: answers.category.choice,
    categoryConfidence: answers.category.confidence,
    sentiment: answers.sentiment.choice,
    sentimentConfidence: answers.sentiment.confidence,
    urgency: urgencyWhenShown(isRelevant, urgencyNormalized),
    urgencyRaw,
    audienceTag: answers.audience.choice as AudienceTag,
    trace: {
      claim: Object.values(statements).join("\n"),
      state: stateText,
      threshold,
      answers,
    },
  };
}

/**
 * Drops the subreddits that clearly do not fit the product, and puts the ones
 * where people who decide on buying it post first, because only the first few
 * fit in one search. Each community is one question in a single Jev call. Only a
 * clear no removes one, and the best few stay if every score is low, so the user
 * always has something to review. If the call fails, every candidate is kept.
 */
export async function keepBuyerCommunities<T extends { name: string; description: string }>(
  candidates: T[],
  brief: { product: string },
): Promise<T[]> {
  if (candidates.length === 0) return candidates;

  const questions: Record<string, ReturnType<typeof noul>> = {};
  candidates.forEach((community, index) => {
    questions[`community_${index}`] = noul(
      `People who buy this product, or who work in the trade it serves, post in r/${community.name} (${community.description.slice(0, 300)}).`,
    );
    questions[`decider_${index}`] = noul(
      `Owners, managers, or buyers at businesses that would pay for this product post in r/${community.name} (${community.description.slice(0, 300)}).`,
    );
  });

  try {
    const response = await client.systemOne({
      state: `Product: ${brief.product}`,
      questions,
    });
    const scored = candidates.map((community, index) => ({
      community,
      score: response.answers[`community_${index}`]?.noul ?? 1,
      decider: response.answers[`decider_${index}`]?.noul ?? 0,
    }));
    const fitting = scored.filter(({ score }) => score > SKIP_AT);
    const kept = fitting.length > 0
      ? fitting
      : [...scored].sort((a, b) => b.score - a.score).slice(0, MIN_COMMUNITIES);
    return [...kept].sort((a, b) => b.decider - a.decider).map(({ community }) => community);
  } catch (error) {
    console.warn(
      `Could not score subreddits: ${error instanceof Error ? error.message : "Unknown"}`,
    );
    return candidates;
  }
}

/** Result of the onboarding guardrail check. */
export interface GuardrailResult {
  /** `true` when the message passes all guardrail checks. */
  passed: boolean;
  /** Human-readable rejection reason (only set when `passed` is `false`). */
  reason?: string;
  /** Raw Jev noul scores for each guardrail question. */
  scores: {
    isAboutBusiness: number;
    targetsIndividual: number;
  };
}

/**
 * Runs two Jev guardrail checks on a raw user message:
 *
 * 1. **is_about_business** — Is the message about monitoring a business/brand?
 *    Fails if score < 0.3.
 * 2. **targets_individual** — Does the message ask to surveil a person?
 *    Fails if score > 0.6.
 *
 * Because Jev is a classification model (not generative), these checks are
 * architecturally immune to prompt-injection attacks.
 *
 * @param message - The raw user text from onboarding chat.
 * @returns Guardrail result with pass/fail and optional rejection reason.
 *
 * @example
 * ```ts
 * const result = await checkGuardrails("Track mentions of Acme Corp");
 * // result.passed === true
 *
 * const bad = await checkGuardrails("Track my ex-boyfriend John");
 * // bad.passed === false
 * // bad.reason === "We can only monitor businesses and products…"
 * ```
 */
export async function checkGuardrails(
  message: string,
  /** What this chat has already established. A short reply is scored inside it. */
  setup?: string,
): Promise<GuardrailResult> {
  const response = await client.systemOne({
    state: setup ? `${setup}\nLatest reply: ${message}` : message,
    questions: {
      is_about_business: noul(
        setup
          ? "The latest reply continues this business-monitoring setup. A short answer, including no, nothing, everyone, or a kind of customer, still belongs to that setup."
          : "This message is about monitoring a business, company, brand, product, or service — not an individual person",
      ),
      targets_individual: noul(
        "The latest reply asks to track, monitor, stalk, or surveil a specific individual person (not a company or brand)",
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
