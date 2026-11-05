import { CategoryIcon } from "@/components/icons";
import { CATEGORY_LABELS, type Category } from "@/lib/types";

/**
 * Renders a post category as a labelled badge with an emoji prefix.
 *
 * Falls back to the raw string when the category isn't one of the known
 * `Category` constants.
 *
 * @param category - The category identifier (e.g. `"complaint"`, `"praise"`).
 *
 * @example
 * ```tsx
 * <CategoryBadge category="bug_report" />  // 🐛 Bug Report
 * ```
 */
export interface CategoryBadgeProps {
  category: string;
}

export function CategoryBadge({ category }: CategoryBadgeProps) {
  return (
    <span className="badge badge-outline gap-1">
      <CategoryIcon category={category} />
      {CATEGORY_LABELS[category as Category] ?? category}
    </span>
  );
}
