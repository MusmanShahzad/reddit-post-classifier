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

export const CATEGORY_EMOJI: Record<Category, string> = {
  complaint: "😤",
  bug_report: "🐛",
  product_idea: "💡",
  praise: "⭐",
  recommendation_ask: "🔍",
  other: "📝",
};

export const SENTIMENTS = ["positive", "negative", "neutral"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const SENTIMENT_LABELS: Record<Sentiment, string> = {
  positive: "Positive",
  negative: "Negative",
  neutral: "Neutral",
};

export const SENTIMENT_EMOJI: Record<Sentiment, string> = {
  positive: "😊",
  negative: "😠",
  neutral: "😐",
};

export function getUrgencyColor(urgency: number): string {
  if (urgency >= 5) return "text-red-600 bg-red-100";
  if (urgency >= 4) return "text-orange-600 bg-orange-100";
  if (urgency >= 3) return "text-yellow-600 bg-yellow-100";
  if (urgency >= 2) return "text-blue-600 bg-blue-100";
  return "text-gray-600 bg-gray-100";
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
