import {
  AlertTriangle,
  BadgeCheck,
  Bug,
  Circle,
  Flame,
  Lightbulb,
  MessageSquareExclamationPoint,
  Search,
  FaceNeutral,
  FaceSlightlyFrowning,
  FaceSlightlySmiling,
  Star,
  StickyNote,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { AudienceTag, Category, Sentiment } from "@/lib/types";

const CATEGORY_ICONS: Record<Category, LucideIcon> = {
  complaint: MessageSquareExclamationPoint,
  bug_report: Bug,
  product_idea: Lightbulb,
  praise: Star,
  recommendation_ask: Search,
  other: StickyNote,
};

const SENTIMENT_ICONS: Record<Sentiment, LucideIcon> = {
  positive: FaceSlightlySmiling,
  negative: FaceSlightlyFrowning,
  neutral: FaceNeutral,
};

const AUDIENCE_ICONS: Record<AudienceTag, LucideIcon> = {
  customer: BadgeCheck,
  competitor_customer: UserRound,
  potential_customer: UserRound,
  former_customer: UserRound,
  unrelated: UserRound,
};

function Glyph({
  icon: Icon,
  className = "size-3.5",
}: {
  icon: LucideIcon;
  className?: string;
}) {
  return <Icon className={`${className} shrink-0`} aria-hidden />;
}

export function CategoryIcon({
  category,
  className,
}: {
  category: string;
  className?: string;
}) {
  return (
    <Glyph
      icon={CATEGORY_ICONS[category as Category] ?? StickyNote}
      className={className}
    />
  );
}

export function SentimentIcon({
  sentiment,
  className,
}: {
  sentiment: string;
  className?: string;
}) {
  return (
    <Glyph
      icon={SENTIMENT_ICONS[sentiment as Sentiment] ?? FaceNeutral}
      className={className}
    />
  );
}

export function AudienceIcon({
  audienceTag,
  className,
}: {
  audienceTag: string;
  className?: string;
}) {
  return (
    <Glyph
      icon={AUDIENCE_ICONS[audienceTag as AudienceTag] ?? UserRound}
      className={className}
    />
  );
}

export function UrgencyIcon({
  urgency,
  className,
}: {
  urgency: number;
  className?: string;
}) {
  const icon = urgency >= 5 ? Flame : urgency >= 4 ? AlertTriangle : Circle;
  return <Glyph icon={icon} className={className} />;
}
