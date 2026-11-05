/**
 * Checks that run after Jev scores a post and before the post is shown.
 *
 * Jev picks from fixed answers, so it cannot invent text. It can still be
 * wrong or unsure. These checks only use the post text and the user's own
 * brief, so they cost nothing and cannot make anything up either. A post the
 * checks do not back up is held for review instead of being shown as a match.
 */

/**
 * At or below this score a post is skipped. Between this and the threshold it
 * is unsure and waits for a person. These are the starting bands TypeSafe
 * suggests for a noul, and they should be tuned against labelled posts.
 */
export const SKIP_AT = 0.3;

/** A post this far from what the user asked to find waits for a person. */
export const REQUEST_MISMATCH_AT = 0.1;

/** A possible lead below this may not be the buyer, so it waits for a person. */
export const BUYER_DOUBT_BELOW = 0.5;

/**
 * Whether a post is kept at all. An unsure score with no recognisable purpose is
 * skipped, because almost all of those were noise that a person had to clear.
 */
export function keepsPost(score: number, threshold: number, category?: string | null): boolean {
  if (score <= SKIP_AT) return false;
  return score >= threshold || category !== "other";
}

/** Short or common words that cannot prove what a post is about. */
const WEAK_WORDS = new Set([
  "about", "also", "best", "business", "buy", "company", "customer", "customers", "find",
  "from", "good", "great", "help", "into", "like", "made", "make", "more", "most", "need",
  "people", "post", "posts", "product", "products", "review", "reviews", "sell", "sells",
  "service", "services", "some", "stuff", "that", "their", "them", "they", "thing", "things",
  "this", "very", "want", "what", "when", "where", "which", "with", "your", "bad", "worst",
  "all", "and", "any", "app", "apps", "are", "can", "for", "get", "its", "new", "not", "our",
  "own", "the", "use", "you",
]);

export interface EvidenceInput {
  title: string;
  body: string;
  brands: string[];
  competitors: string[];
  aliases?: string[];
  product?: string;
  definingTopics?: string[];
}

export interface Evidence {
  /** Names from the brief found in the post. */
  names: string[];
  /** Product words from the brief found in the post. */
  productWords: string[];
}

function plain(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function contains(haystack: string, phrase: string): boolean {
  const needle = plain(phrase).trim();
  if (needle.length < 2) return false;
  if (haystack.includes(` ${needle} `)) return true;
  // People split and join names: "shop monkey", "Mitchell 1", "autoleap".
  const joined = needle.replaceAll(" ", "");
  return joined.length >= 4 && new RegExp(` ${[...joined].join(" ?")} `).test(haystack);
}

/** Whether the text names this company or product, however it spaces the name. */
export function mentionsName(text: string, name: string): boolean {
  return contains(plain(text), name);
}

/** Product words worth matching. Plural and singular both count. */
function productTerms(product: string, topics: string[]): string[] {
  const words = new Set<string>();
  for (const source of [product, ...topics]) {
    for (const word of plain(source).trim().split(" ")) {
      if (word.length < 3 || WEAK_WORDS.has(word)) continue;
      words.add(word);
      if (word.endsWith("s") && word.length > 3) words.add(word.slice(0, -1));
      else words.add(`${word}s`);
    }
  }
  return [...words];
}

/** What in the post text backs up the match. Empty lists mean nothing does. */
export function findEvidence(input: EvidenceInput): Evidence {
  const text = plain(`${input.title} ${input.body}`);
  const names = [...input.brands, ...input.competitors, ...(input.aliases ?? [])].filter((name) =>
    contains(text, name),
  );
  const productWords = productTerms(input.product ?? "", input.definingTopics ?? []).filter((word) =>
    text.includes(` ${word} `),
  );
  return { names: [...new Set(names)], productWords: [...new Set(productWords)].slice(0, 6) };
}

/** Aliases are saved as a JSON list; older rows may be comma separated. */
export function aliasList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    // Not JSON.
  }
  return raw.split(",").map((alias) => alias.trim()).filter(Boolean);
}

export interface SessionKeyword {
  type: string;
  value: string;
  aliases?: string | null;
}

/** Evidence for one post, read from the session's keywords and brief. */
export function sessionEvidence(
  post: { title: string; body: string },
  session: { name: string; product: string; keywords: SessionKeyword[] },
): Evidence {
  const of = (type: string) => session.keywords.filter((keyword) => keyword.type === type);
  return findEvidence({
    title: post.title,
    body: post.body,
    brands: [session.name, ...of("brand").map((keyword) => keyword.value)],
    competitors: of("competitor").map((keyword) => keyword.value),
    aliases: session.keywords.flatMap((keyword) =>
      keyword.type === "topic" ? [] : aliasList(keyword.aliases),
    ),
    product: session.product,
    definingTopics: of("topic").map((keyword) => keyword.value),
  });
}

export function hasEvidence(evidence: Evidence): boolean {
  return evidence.names.length > 0 || evidence.productWords.length > 0;
}

/** The kind of post the user asked for, when it carries a clear mood. */
export function askedMood(keepWhen: string): "negative" | "positive" | null {
  const text = plain(keepWhen);
  if (/ (bad|negative|complain|complaint|complaints|unhappy|angry|frustrated|problem|problems|issue|issues|broken|refund|worst|hate|disappointed) /.test(text)) {
    return "negative";
  }
  if (/ (praise|positive|happy|love|recommend|recommendation|recommendations|good reviews|testimonial|testimonials) /.test(text)) {
    return "positive";
  }
  return null;
}

export type FilterVerdict = "show" | "review" | "skip";

export interface FilterCheck {
  id: "score" | "mood" | "request" | "buyer";
  passed: boolean;
  detail: string;
}

export interface FilterDecision {
  verdict: FilterVerdict;
  /** True when the score sits between the skip line and the threshold. */
  borderline: boolean;
  checks: FilterCheck[];
  evidence: Evidence;
}

export interface DecisionInput {
  score: number;
  threshold: number;
  evidence: Evidence;
  keepWhen?: string;
  sentiment?: string | null;
  sentimentConfidence?: number | null;
  /** Jev's score for whether the post matches what the user asked to find. */
  requestScore?: number | null;
  /** The author's match with the session's buyer, when the post is only a possible lead. */
  buyerScore?: number | null;
  /** Jev's label for the post's main purpose. */
  category?: string | null;
}

/**
 * Skips a clearly low score, shows a clearly high one, and holds anything
 * between for review. A post that clashes with the mood the user asked for, that
 * clearly is not what they asked to find, or whose author may not be the buyer
 * is also held. Naming a brand or product is recorded but is not required, since
 * a potential client often names neither.
 */
export function judgeDecision(input: DecisionInput): FilterDecision {
  const skipped = !keepsPost(input.score, input.threshold, input.category);
  const clear = input.score >= input.threshold;
  const borderline = !skipped && !clear;

  const checks: FilterCheck[] = [
    {
      id: "score",
      passed: clear,
      detail: borderline
        ? `Score ${input.score.toFixed(2)} is between ${SKIP_AT} and the ${input.threshold} threshold`
        : `Score ${input.score.toFixed(2)} against the ${input.threshold} threshold`,
    },
  ];

  if (skipped) {
    return { verdict: "skip", borderline, checks, evidence: input.evidence };
  }

  const mood = askedMood(input.keepWhen ?? "");
  const sure = (input.sentimentConfidence ?? 0) >= 0.6;
  const clash =
    sure &&
    ((mood === "negative" && input.sentiment === "positive") ||
      (mood === "positive" && input.sentiment === "negative"));
  if (mood) {
    checks.push({
      id: "mood",
      passed: !clash,
      detail: clash
        ? `They asked for ${mood} posts, but this post reads ${input.sentiment}`
        : `Matches the ${mood} posts they asked for`,
    });
  }

  if (typeof input.requestScore === "number") {
    const matches = input.requestScore > REQUEST_MISMATCH_AT;
    checks.push({
      id: "request",
      passed: matches,
      detail: matches
        ? "Does not clearly conflict with what they asked to find"
        : `Scored ${input.requestScore.toFixed(2)} against what they asked to find`,
    });
  }

  if (typeof input.buyerScore === "number") {
    const matches = input.buyerScore >= BUYER_DOUBT_BELOW;
    checks.push({
      id: "buyer",
      passed: matches,
      detail: matches
        ? "The author looks like the buyer"
        : `Scored ${input.buyerScore.toFixed(2)} as the buyer they described`,
    });
  }

  const allPassed = checks.every((check) => check.passed);
  return { verdict: allPassed ? "show" : "review", borderline, checks, evidence: input.evidence };
}

export interface QualityCounts {
  classified: number;
  shown: number;
  review: number;
  borderline: number;
  shownWithEvidence: number;
  /** Shown posts the user kept or handled. */
  confirmed: number;
  /** Shown posts the user dismissed. */
  rejected: number;
  /** Posts the filter skipped that the user marked relevant. */
  rescued: number;
  briefFilled: number;
  briefTotal: number;
  /** Plain names of the brief answers still empty, such as "who buys it". */
  briefMissing?: string[];
}

export interface QualityMetric {
  id: "evidence" | "confidence" | "precision" | "misses" | "brief";
  label: string;
  /** 0 to 1, or null when there is not enough data yet. */
  value: number | null;
  detail: string;
}

export interface FilterQuality {
  /**
   * Average of the metrics that have data, 0 to 100. Null before any post is
   * classified, and while none has reached the feed, because a filter that is
   * consistent about rejecting everything has not shown it finds the right posts.
   */
  score: number | null;
  metrics: QualityMetric[];
  /** Something the user should act on, such as a session finding nothing useful. */
  warning?: string | null;
}

/** User feedback needed before precision and misses are reported. */
export const MIN_FEEDBACK = 5;

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : null);

/** Turns the counts into the metrics shown on the dashboard. */
export function filterQuality(counts: QualityCounts): FilterQuality {
  const reviewed = counts.confirmed + counts.rejected;
  const metrics: QualityMetric[] = [
    {
      id: "brief",
      label: "Brief complete",
      value: ratio(counts.briefFilled, counts.briefTotal),
      detail:
        counts.briefMissing && counts.briefMissing.length > 0
          ? `${counts.briefFilled} of ${counts.briefTotal} answers. Still missing: ${counts.briefMissing.join(" and ")}`
          : `${counts.briefFilled} of ${counts.briefTotal} answers`,
    },
    {
      id: "evidence",
      label: "Shown posts backed by the text",
      value: ratio(counts.shownWithEvidence, counts.shown),
      detail:
        counts.shown > 0
          ? `${counts.shownWithEvidence} of ${counts.shown} shown posts name the brand, a competitor, or the product`
          : "No posts shown yet",
    },
    {
      id: "confidence",
      label: "Clear decisions",
      value: ratio(counts.classified - counts.borderline, counts.classified),
      detail:
        counts.classified > 0
          ? `${counts.borderline} of ${counts.classified} scores were close to the threshold. ${counts.review} held for review`
          : "Nothing classified yet",
    },
    {
      id: "precision",
      label: "Matches you agreed with",
      value: reviewed >= MIN_FEEDBACK ? ratio(counts.confirmed, reviewed) : null,
      detail:
        reviewed >= MIN_FEEDBACK
          ? `${counts.confirmed} handled, ${counts.rejected} dismissed`
          : `Handle or dismiss ${Math.max(MIN_FEEDBACK - reviewed, 0)} more shown posts to measure this`,
    },
    {
      id: "misses",
      label: "Skipped posts that were right to skip",
      value:
        counts.classified - counts.shown - counts.review >= MIN_FEEDBACK
          ? 1 - (ratio(counts.rescued, counts.classified - counts.shown - counts.review) ?? 0)
          : null,
      detail:
        counts.rescued > 0
          ? `${counts.rescued} skipped posts were marked relevant by you`
          : "No skipped post has been marked relevant",
    },
  ];

  // Posts from potential clients often name nothing, so that metric informs but does not score.
  const known = metrics
    .filter((metric) => metric.id !== "evidence")
    .map((metric) => metric.value)
    .filter((value): value is number => value !== null);
  const nothingShown = counts.classified > 0 && counts.shown === 0;
  const score =
    !nothingShown && counts.classified > 0 && known.length > 0
      ? Math.round((known.reduce((a, b) => a + b, 0) / known.length) * 100)
      : null;
  const warning = nothingShown
    ? `None of the ${counts.classified} classified ${counts.classified === 1 ? "post has" : "posts have"} reached the feed.${
        counts.review > 0 ? ` ${counts.review} ${counts.review === 1 ? "waits" : "wait"} for your check.` : ""
      } If this continues, check that the competitors and searches in Settings fit what you want to find.`
    : null;
  return { score, metrics, warning };
}

export interface MeasuredPost {
  title: string;
  body: string;
  isRelevant: boolean | null;
  relevanceScore: number | null;
  status: string;
}

export interface MeasuredSession {
  name: string;
  product: string;
  buyer: string;
  keepWhen: string;
  notAbout: string;
  keywords: SessionKeyword[];
}

/** Counts every metric input from the saved posts of one session. */
export function measureFilter(
  session: MeasuredSession | null,
  posts: MeasuredPost[],
  threshold: number,
): FilterQuality & { counts: QualityCounts } {
  const brief = session ? [session.name, session.product, session.keepWhen, session.buyer, session.notAbout] : [];
  const briefMissing = session
    ? [
        !session.buyer.trim() ? "who buys it" : "",
        !session.notAbout.trim() ? "what to skip" : "",
      ].filter(Boolean)
    : [];
  const counts: QualityCounts = {
    classified: 0,
    shown: 0,
    review: 0,
    borderline: 0,
    shownWithEvidence: 0,
    confirmed: 0,
    rejected: 0,
    rescued: 0,
    briefFilled: brief.filter((answer) => answer.trim().length > 0).length,
    briefTotal: 5,
    briefMissing,
  };

  for (const post of posts) {
    if (post.isRelevant === null) continue;
    counts.classified++;
    const score = post.relevanceScore ?? 0;
    if (score > SKIP_AT && score < threshold) counts.borderline++;
    if (post.status === "review") {
      counts.review++;
      continue;
    }
    if (!post.isRelevant) continue;
    // A skipped score that is now relevant means the user moved it in by hand.
    if (score <= SKIP_AT) {
      counts.rescued++;
      continue;
    }
    counts.shown++;
    if (session && hasEvidence(sessionEvidence(post, session))) counts.shownWithEvidence++;
    if (post.status === "handled") counts.confirmed++;
    if (post.status === "dismissed") counts.rejected++;
  }

  return { ...filterQuality(counts), counts };
}
