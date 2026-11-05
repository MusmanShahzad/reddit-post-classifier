/**
 * Turns what onboarding learned into the relevance check.
 *
 * Nothing here assumes an industry. The keep and skip rules are the user's
 * own words. Broad topic words are search hints and never decide a post.
 */

import { GOALS, type Goal } from "@/lib/goals";

const BROAD_WORDS = new Set([
  "advice",
  "app",
  "apps",
  "best",
  "business",
  "company",
  "customer",
  "customers",
  "guide",
  "help",
  "management",
  "product",
  "products",
  "review",
  "reviews",
  "service",
  "services",
  "shop",
  "shops",
  "software",
  "tool",
  "tools",
]);

export interface ScopeKeyword {
  type: string;
  value: string;
}

export interface MonitoringScope {
  brands: string[];
  competitors: string[];
  definingTopics: string[];
  broadTopics: string[];
}

export function monitoringScope(keywords: ScopeKeyword[]): MonitoringScope {
  const brands = values(keywords, "brand");
  const competitors = values(keywords, "competitor");
  const definingTopics: string[] = [];
  const broadTopics: string[] = [];

  for (const topic of values(keywords, "topic")) {
    const specific = topic
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 3 && !BROAD_WORDS.has(word));
    if (specific.length > 0) definingTopics.push(topic);
    else broadTopics.push(topic);
  }

  return { brands, competitors, definingTopics, broadTopics };
}

/** Saved when the user says there is nothing to skip. */
export const NOTHING_TO_SKIP = "nothing in particular";

/** What the chat gathers before any search or filter is built. */
export interface ProductBrief {
  /** The company or brand name. */
  companyName: string;
  /** What they sell, in their words. */
  product: string;
  /** Who buys or uses it. Optional. Not required before the search is set up. */
  buyer: string;
  /** What a post must show to be worth the team's time. */
  keepWhen: string;
  /** Subjects that share words with the product but must be skipped. Optional. */
  notAbout: string;
}

export const BRIEF_LABELS: Record<keyof ProductBrief, string> = {
  companyName: "the company name",
  product: "what they sell",
  buyer: "who buys it",
  keepWhen: "what a post must show to be worth their time",
  notAbout: "what looks similar but should be skipped",
};

/** These three are enough to set up the search. Buyer and skip are optional. */
const REQUIRED_FIELDS = ["companyName", "product", "keepWhen"] as const satisfies readonly (keyof ProductBrief)[];
const BRIEF_FIELDS = ["companyName", "product", "buyer", "keepWhen", "notAbout"] as const satisfies readonly (keyof ProductBrief)[];

export const REQUIRED_BRIEF_COUNT = REQUIRED_FIELDS.length;

function normalized(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/[.?!]+$/g, "").replace(/\s+/g, " ");
}

/** A field counts when the user wrote something. The model decides if it is clear. */
export function briefAnswerCounts(value: string | undefined): boolean {
  return normalized(value).length > 0;
}

function openFields(brief: Partial<ProductBrief> | null | undefined): (keyof ProductBrief)[] {
  return REQUIRED_FIELDS.filter((key) => !briefAnswerCounts(brief?.[key]));
}

/** Why a starter field cannot be sent yet. An empty box is the only block; the model judges clarity. */
export function starterIssue(value: string): string | null {
  return value.trim() ? null : "Add this before continuing.";
}

/** The brief questions that are still unanswered. Empty means the brief is complete. */
export function missingBrief(brief: Partial<ProductBrief> | null | undefined): string[] {
  return openFields(brief).map((key) => BRIEF_LABELS[key]);
}

/**
 * The user said there is nothing to skip. A short "no" only counts when it
 * is the whole reply, so a real skip rule is not thrown away.
 */
export function declinesSkip(message: string): boolean {
  const plain = normalized(message).replace(/['’]/g, "");
  if (!plain || plain.length > 80) return false;
  return (
    /^(?:no|nope|nah|none|nothing|not really|no thanks|nothing to skip|no skip|skip nothing|dont skip anything|not that i can think of|there isnt any|there is nothing|i dont think so(?: any)?|dont think so(?: any)?)$/.test(plain) ||
    /^(?:i )?dont think(?: so)?(?: any| there is any| theres any)?$/.test(plain)
  );
}

/** Drops a field the user left blank. */
export function cleanBrief<T extends Partial<ProductBrief>>(brief: T): T {
  const next = { ...brief };
  for (const key of BRIEF_FIELDS) {
    if (!briefAnswerCounts(next[key])) next[key] = "";
  }
  return next;
}

/** Every brief field as text, with blank answers cleared. */
function keptBrief(brief: Partial<ProductBrief> | null | undefined): ProductBrief {
  return cleanBrief({
    companyName: brief?.companyName ?? "",
    product: brief?.product ?? "",
    buyer: brief?.buyer ?? "",
    keepWhen: brief?.keepWhen ?? "",
    notAbout: brief?.notAbout ?? "",
  });
}

/**
 * Memory for the next turn. The brief facts always stay, and a model summary
 * is kept when it adds something the facts do not already say.
 */
export function chatSummary(brief: Partial<ProductBrief> | null | undefined, modelSummary?: string): string {
  const kept = keptBrief(brief);
  const facts = [
    kept.companyName ? `Company: ${kept.companyName}.` : "",
    kept.product ? `They sell ${kept.product}.` : "",
    kept.buyer ? `Who buys it: ${kept.buyer}.` : "",
    kept.keepWhen ? `They want found: ${kept.keepWhen}.` : "",
    kept.notAbout ? `They want skipped: ${kept.notAbout}.` : "",
  ].filter((line) => line.length > 0);
  const base = facts.join(" ");
  const model = (modelSummary ?? "").trim().replace(/\s+/g, " ");
  if (!model) return base.slice(0, 900);
  const covered = facts.every((fact) => model.toLowerCase().includes(fact.slice(0, -1).toLowerCase()));
  return (covered ? model : `${base} ${model}`).slice(0, 900);
}

/**
 * Extra instruction for this turn. It tells the model what is already known
 * and how to ask, so the reply is not a checklist of the user's own words.
 */
export function replyGuidance(
  known: Partial<ProductBrief> | null | undefined,
  earlier: string[] = [],
): string {
  const kept = keptBrief(known);
  const gap = openFields(kept)[0];
  const knownLines = [
    kept.companyName ? `Company: "${kept.companyName}".` : "",
    kept.product ? `They sell "${kept.product}".` : "",
    kept.buyer ? `Who buys it: "${kept.buyer}".` : "",
    kept.keepWhen ? `They want found, in their words: "${kept.keepWhen}". Do not shorten this.` : "",
    kept.notAbout ? `They want skipped: "${kept.notAbout}".` : "",
  ].filter((line) => line.length > 0);

  const lines = [
    "conversationalReply is the only text the user reads. Write one short message, the way a person would ask a colleague.",
    "Do not recap with 'You sell', 'Your customers are', 'I'll look for', or 'I'll skip'. Do not use field names.",
    "The search needs the company name, what they sell, and what to find. Do not ask who buys it. Do not ask what to skip.",
    "An answer is clear only when it is specific enough to filter posts. \"Nothing\", \"everything\", \"posts\", \"stuff\", and \"not sure\" are not clear. Leave that field empty, set needsClarification true, and ask one question so the requirement is specific. Keep a specific answer and do not ask again.",
    gap ? `This fact is still empty: ${BRIEF_LABELS[gap]}.` : "All three facts have an answer.",
    "This message continues the same setup. It is not a new one, so do not ask them to describe the business again.",
    earlier.length > 0 ? `Earlier messages from the user: ${earlier.map((line) => `"${line}"`).join(" | ")}.` : "",
    "If they say there is nothing to skip, set notAbout to \"nothing in particular\" and do not ask that again.",
    ...knownLines,
  ];
  return lines.filter((line) => line.length > 0).join(" ");
}

/** Shown once the company, what they sell, and what to find are all specific. */
export function readyToMove(): string {
  return "That's enough to set this up. Check the details below and change anything you want.";
}

/** Each statement Jev scores on its own. Optional ones exist only when the brief gave the rule. */
export interface RelevanceStatements {
  about_brand?: string;
  about_competitor?: string;
  competitor_market?: string;
  about_market?: string;
  buying_intent?: string;
  buyer_match?: string;
  matches_request?: string;
  excluded?: string;
  promotional: string;
}

/** Scores from 0 to 1 for {@link RelevanceStatements}. */
export type RelevanceScores = { [K in keyof RelevanceStatements]?: number };

function joinedNames(names: Array<string | undefined>): string {
  return [...new Set(names.map((name) => name?.trim()).filter(Boolean))].join(", ");
}

/**
 * One statement per rule, because Jev answers best when each question covers
 * one thing. Which statements exist depends on what the session is looking for:
 * feedback must be about the named company, while a potential client can name
 * nobody but must be looking for this kind of product.
 */
export function relevanceStatements(input: {
  companyName: string;
  scope: MonitoringScope;
  goals?: Goal[];
  brandAliases?: string[];
  competitorAliases?: string[];
  brief?: Partial<ProductBrief> | null;
}): RelevanceStatements {
  const goals = input.goals ?? GOALS;
  const product =
    input.brief?.product?.trim() || input.scope.definingTopics.join(", ") || `what ${input.companyName} sells`;
  const buyer = input.brief?.buyer?.trim();
  const keepWhen = input.brief?.keepWhen?.trim();
  const notAbout = input.brief?.notAbout?.trim();
  const hasSkipRule = notAbout && notAbout.toLowerCase() !== NOTHING_TO_SKIP;

  const brandNames = joinedNames([input.companyName, ...input.scope.brands, ...(input.brandAliases ?? [])]);
  const rivalNames = joinedNames([...input.scope.competitors, ...(input.competitorAliases ?? [])]);
  const wantsRivals = goals.includes("competitor_feedback") && rivalNames.length > 0;
  const wantsBrand = goals.includes("own_feedback");
  const wantsClients = goals.includes("potential_clients") || (!wantsBrand && !wantsRivals);

  return {
    ...(wantsBrand
      ? {
          about_brand: `The post is mainly about ${brandNames}, a business that sells this kind of product: ${product}. The author reviews it, complains about it, praises it, reports a problem with it, or asks about it. Naming it in passing does not count.`,
        }
      : {}),
    ...(wantsRivals
      ? {
          about_competitor: `The post is mainly about one of these businesses that sell this kind of product (${product}): ${rivalNames}. The author reviews it, complains about it, praises it, reports a problem with it, or asks about it. Naming it in passing does not count.`,
          competitor_market: `The post is about this kind of product or service: ${product}.`,
        }
      : {}),
    ...(wantsClients
      ? {
          about_market: `The author is choosing, buying, using, or having a problem with this kind of product: ${product}.`,
          buying_intent: `The author is looking for, comparing, or deciding on this kind of product for their own business or use: ${product}.`,
          ...(buyer ? { buyer_match: `The author is one of these people, or is buying on behalf of one: ${buyer}.` } : {}),
        }
      : {}),
    ...(keepWhen ? { matches_request: `The post is this kind of conversation: ${keepWhen}.` } : {}),
    ...(hasSkipRule ? { excluded: `The post is about: ${notAbout}.` } : {}),
    promotional: "The author is selling, advertising, or promoting their own product or service.",
  };
}

/**
 * One relevance score: how well the post serves the best-matching goal, unless
 * it is excluded or an advert. A free-text request does not lower the score,
 * because a request written from the seller's side scored clear leads as low as
 * 0.26. See {@link judgeDecision}.
 *
 * A competitor post must also be about this market. A parcel complaint scored
 * 0.89 as being about FedEx, but it says nothing to a pharmacy delivery company.
 */
export function combineRelevance(scores: RelevanceScores): number {
  const bestGoal = Math.max(feedbackScore(scores), leadScore(scores));
  return Math.min(bestGoal, 1 - (scores.excluded ?? 0), 1 - (scores.promotional ?? 0));
}

/** At or below this, the author is clearly not the buyer, even if the buyer was loosely worded. */
const CLEARLY_NOT_THE_BUYER = 0.1;

function feedbackScore(scores: RelevanceScores): number {
  const competitor = Math.min(scores.about_competitor ?? 0, scores.competitor_market ?? 1);
  return Math.max(scores.about_brand ?? 0, competitor);
}

function leadScore(scores: RelevanceScores): number {
  if (scores.about_market === undefined || scores.buying_intent === undefined) return 0;
  if (scores.buyer_match !== undefined && scores.buyer_match <= CLEARLY_NOT_THE_BUYER) return 0;
  return Math.min(scores.about_market, scores.buying_intent);
}

/**
 * The buyer score, when the post is kept only as a possible lead. Feedback about
 * a brand or competitor can come from anyone, so it returns null for those.
 */
export function leadBuyerScore(scores: RelevanceScores | null | undefined): number | null {
  if (!scores || leadScore(scores) <= feedbackScore(scores)) return null;
  return scores.buyer_match ?? null;
}

/**
 * The part of a long post worth reading: its opening, its ending, and the text
 * around each name. A short post is returned whole.
 */
export function postExcerpt(body: string, names: string[] = [], maxLength = 2000): string {
  if (body.length <= maxLength) return body;

  const opening = Math.floor(maxLength / 2);
  const ending = Math.floor(maxLength * 0.15);
  const reach = 150;
  const windows: Array<[number, number]> = [[0, opening]];
  let budget = maxLength - opening - ending;

  const patterns = names
    .map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((name) => name.length >= 2)
    .map((name) => new RegExp([...name].join("[\\s-]?"), "gi"));

  const mentions = patterns
    .flatMap((pattern) => [...body.matchAll(pattern)].map((match) => match.index))
    .filter((index) => index >= opening)
    .sort((a, b) => a - b);

  for (const index of mentions) {
    if (budget <= 0) break;
    const last = windows[windows.length - 1]!;
    if (index < last[1]) continue;
    const start = Math.max(last[1], index - reach);
    const end = Math.min(start + Math.min(budget, reach * 2), body.length);
    windows.push([start, end]);
    budget -= end - start;
  }

  const tailStart = Math.max(windows[windows.length - 1]![1], body.length - ending);
  if (tailStart < body.length) windows.push([tailStart, body.length]);

  return windows
    .reduce<string[]>((parts, [start, end], index) => {
      const touches = index > 0 && windows[index - 1]![1] === start;
      const text = body.slice(start, end).trim();
      return [...parts, touches ? text : index === 0 ? text : `… ${text}`];
    }, [])
    .join(" ");
}

/** Jev's urgency runs from 0 and may fall between levels. The app shows 1 to 5. */
export function urgencyLevel(raw: number): number {
  return Math.min(5, Math.max(1, Math.round(raw) + 1));
}

/**
 * Urgency answers "how soon should the team act". A post that is not worth
 * showing has no urgency, whatever the model scored for the text alone.
 */
export function urgencyWhenShown(isRelevant: boolean, urgency: number): number | null {
  return isRelevant ? urgency : null;
}

function values(keywords: ScopeKeyword[], type: string): string[] {
  return keywords
    .filter((keyword) => keyword.type === type)
    .map((keyword) => keyword.value.trim())
    .filter((value) => value.length > 0);
}
