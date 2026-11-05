export const CATEGORIES = [
  "complaint",
  "bug_report",
  "product_idea",
  "praise",
  "recommendation_ask",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  complaint: "Complaint",
  bug_report: "Bug Report",
  product_idea: "Product Idea",
  praise: "Praise",
  recommendation_ask: "Recommendation",
  other: "Other",
};

export const SENTIMENTS = ["positive", "negative", "neutral"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const SENTIMENT_LABELS: Record<Sentiment, string> = {
  positive: "Positive",
  negative: "Negative",
  neutral: "Neutral",
};

export const AUDIENCE_TAGS = [
  "customer",
  "competitor_customer",
  "potential_customer",
  "former_customer",
  "unrelated",
] as const;
export type AudienceTag = (typeof AUDIENCE_TAGS)[number];

export const AUDIENCE_LABELS: Record<AudienceTag, string> = {
  customer: "Customer",
  competitor_customer: "Competitor's customer",
  potential_customer: "Potential customer",
  former_customer: "Former customer",
  unrelated: "Not a buyer",
};

export function getUrgencyColor(urgency: number): string {
  if (urgency >= 5) return "badge-error";
  if (urgency >= 4) return "badge-warning";
  if (urgency >= 3) return "badge-info";
  return "badge-ghost";
}

export function getUrgencyLabel(urgency: number): string {
  if (urgency >= 5) return "Critical";
  if (urgency >= 4) return "High";
  if (urgency >= 3) return "Medium";
  if (urgency >= 2) return "Low";
  return "None";
}

export function timeAgo(date: Date | string): string {
  const now = new Date();
  const then = new Date(date);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
