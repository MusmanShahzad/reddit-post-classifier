import { AnimatedNumber, AnimatedProgress } from "@/components/atoms";
import { CategoryIcon } from "@/components/icons";
import { CATEGORY_LABELS, type Category } from "@/lib/types";

/**
 * A horizontal bar chart showing the distribution of posts across categories.
 *
 * Each category displays an emoji, label, proportional bar, and count. Falls
 * back to an empty-state message when no data is available.
 *
 * @param categories   - Array of `{ category, count }` from the stats query.
 * @param totalRelevant - Total relevant post count used to calculate bar widths.
 *
 * @example
 * ```tsx
 * <CategoryBreakdown
 *   categories={stats.categories}
 *   totalRelevant={stats.relevant}
 * />
 * ```
 */
export interface CategoryData {
  category: string;
  count: number;
}

export interface CategoryBreakdownProps {
  categories: CategoryData[];
  totalRelevant: number;
}

export function CategoryBreakdown({
  categories,
  totalRelevant,
}: CategoryBreakdownProps) {
  return (
    <div className="card card-border bg-base-100">
      <div className="card-body">
      <h3 className="card-title text-base">Category breakdown</h3>
      <div className="space-y-3">
        {categories.map((c) => (
          <div key={c.category} className="flex items-center gap-3">
            <CategoryIcon category={c.category} className="size-4" />
            <span className="w-28 text-sm font-medium">
              {CATEGORY_LABELS[c.category as Category] ?? c.category}
            </span>
            <AnimatedProgress
              className="progress flex-1"
              value={c.count}
              max={Math.max(totalRelevant, 1)}
            />
            <span className="w-12 text-right text-sm text-base-content/70">
              <AnimatedNumber value={c.count} />
            </span>
          </div>
        ))}
        {categories.length === 0 && (
          <p className="text-sm text-base-content/60">
            No data yet. Run a collection first.
          </p>
        )}
      </div>
      </div>
    </div>
  );
}
