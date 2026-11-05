/**
 * Builds the Prisma `where` clause for the feed.
 *
 * Relevant posts are the default. Not-relevant posts stay saved and only
 * appear when the feed filter asks for them.
 */

/**
 * What "relevant" means on every screen: the post passed the filter and is in
 * the feed. A post held for a check is counted on its own, as "to check".
 */
export const RELEVANT_STATUSES = ["new", "handled"];

export type FeedStatus = "new" | "handled" | "all";
export type FeedRelevance = "relevant" | "review" | "filtered" | "waiting" | "all";

export interface FeedFilterInput {
  category?: string;
  sentiment?: string;
  minUrgency?: number;
  status: FeedStatus;
  relevance: FeedRelevance;
}

export function buildFeedWhere(input: FeedFilterInput): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  if (input.relevance === "waiting") {
    where.status = "pending";
  } else if (input.relevance === "review") {
    where.isRelevant = true;
    where.status = "review";
  } else if (input.relevance === "filtered") {
    where.isRelevant = false;
    where.status = "filtered";
  } else if (input.relevance === "relevant") {
    where.isRelevant = true;
    if (input.status === "new") where.status = "new";
    else if (input.status === "handled") where.status = "handled";
    else where.status = { notIn: ["dismissed", "pending", "filtered", "error", "review"] };
  } else if (input.status === "handled") {
    where.isRelevant = true;
    where.status = "handled";
  } else if (input.status === "new") {
    where.OR = [
      { isRelevant: true, status: "new" },
      { isRelevant: false, status: "filtered" },
      { isRelevant: true, status: "review" },
      { status: "pending" },
    ];
  } else {
    where.status = { notIn: ["dismissed", "error"] };
  }

  if (input.category) where.category = input.category;
  if (input.sentiment) where.sentiment = input.sentiment;
  if (input.minUrgency) where.urgency = { gte: input.minUrgency };

  return where;
}
