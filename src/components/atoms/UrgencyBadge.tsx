import { UrgencyIcon } from "@/components/icons";
import { getUrgencyColor, getUrgencyLabel } from "@/lib/types";

/**
 * Displays a colour-coded urgency badge (1–5 scale).
 *
 * Maps urgency values to labels (None / Low / Medium / High / Critical)
 * and colour classes using shared helpers from `@/lib/types`.
 *
 * @param urgency - Integer 1–5 representing urgency level.
 *
 * @example
 * ```tsx
 * <UrgencyBadge urgency={4} />  // renders "High (4)" in orange
 * ```
 */
export interface UrgencyBadgeProps {
  urgency: number;
}

export function UrgencyBadge({ urgency }: UrgencyBadgeProps) {
  return (
    <span className={`badge gap-1 ${getUrgencyColor(urgency)}`}>
      <UrgencyIcon urgency={urgency} />
      {getUrgencyLabel(urgency)} ({urgency})
    </span>
  );
}
