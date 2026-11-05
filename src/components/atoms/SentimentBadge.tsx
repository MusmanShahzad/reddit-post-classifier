import { SentimentIcon } from "@/components/icons";
import { SENTIMENT_LABELS, type Sentiment } from "@/lib/types";

/**
 * Renders a sentiment classification as a labelled badge with an emoji prefix.
 *
 * @param sentiment - One of `"positive"`, `"negative"`, or `"neutral"`.
 *
 * @example
 * ```tsx
 * <SentimentBadge sentiment="positive" />  // 😊 Positive
 * ```
 */
export interface SentimentBadgeProps {
  sentiment: string;
}

export function SentimentBadge({ sentiment }: SentimentBadgeProps) {
  return (
    <span className="badge badge-outline gap-1">
      <SentimentIcon sentiment={sentiment} />
      {SENTIMENT_LABELS[sentiment as Sentiment] ?? sentiment}
    </span>
  );
}
