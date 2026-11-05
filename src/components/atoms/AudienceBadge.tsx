import { AudienceIcon } from "@/components/icons";
import { AUDIENCE_LABELS, type AudienceTag } from "@/lib/types";

/**
 * Shows whether the post's author is already a customer or not one yet.
 *
 * @param audienceTag - One of `AUDIENCE_TAGS`.
 */
export interface AudienceBadgeProps {
  audienceTag: string;
}

export function AudienceBadge({ audienceTag }: AudienceBadgeProps) {
  return (
    <span className="badge badge-outline gap-1">
      <AudienceIcon audienceTag={audienceTag} />
      {AUDIENCE_LABELS[audienceTag as AudienceTag] ?? audienceTag}
    </span>
  );
}
