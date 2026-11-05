import { X } from "lucide-react";
import { CATEGORIES, CATEGORY_LABELS } from "@/lib/types";
import type { FeedRelevance, FeedStatus } from "@/lib/feed-filter";

/**
 * The Feed's controls: tabs for what kind of post to show, each with a live
 * count, then category, urgency, and status selectors.
 *
 * @param category    - Currently selected category or `undefined` for "all".
 * @param minUrgency  - Minimum urgency filter or `undefined` for "all".
 * @param status      - Current status filter (`"new"`, `"handled"`, or `"all"`).
 * @param relevance   - The selected tab.
 * @param counts      - Live post count for each tab.
 * @param postCount   - Number of matching posts shown next to filters.
 * @param onCategoryChange  - Fires with category string or `undefined`.
 * @param onUrgencyChange   - Fires with urgency number or `undefined`.
 * @param onStatusChange    - Fires with the chosen status string.
 * @param onRelevanceChange - Fires with the chosen tab.
 *
 * @example
 * ```tsx
 * <FilterBar
 *   category={filters.category}
 *   minUrgency={filters.minUrgency}
 *   status={filters.status}
 *   postCount={allPosts.length}
 *   onCategoryChange={(c) => setFilters(f => ({ ...f, category: c }))}
 *   onUrgencyChange={(u) => setFilters(f => ({ ...f, minUrgency: u }))}
 *   onStatusChange={(s) => setFilters(f => ({ ...f, status: s }))}
 * />
 * ```
 */
export interface FilterBarProps {
  category?: string;
  minUrgency?: number;
  status: FeedStatus;
  relevance?: FeedRelevance;
  counts?: Partial<Record<FeedRelevance, number>>;
  postCount: number;
  busy?: boolean;
  onCategoryChange: (value: string | undefined) => void;
  onUrgencyChange: (value: number | undefined) => void;
  onStatusChange: (value: FeedStatus) => void;
  onRelevanceChange?: (value: FeedRelevance) => void;
}

const VIEWS: { id: FeedRelevance; label: string; badge?: string }[] = [
  { id: "relevant", label: "Relevant", badge: "badge-primary" },
  { id: "review", label: "Needs your check", badge: "badge-warning" },
  { id: "filtered", label: "Not relevant" },
  { id: "waiting", label: "Not classified yet" },
  { id: "all", label: "All saved" },
];

export function FilterBar({
  category,
  minUrgency,
  status,
  relevance = "relevant",
  counts,
  postCount,
  busy = false,
  onCategoryChange,
  onUrgencyChange,
  onStatusChange,
  onRelevanceChange,
}: FilterBarProps) {
  const filtered = Boolean(category) || minUrgency !== undefined || status !== "new";

  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Which posts to show" className="tabs tabs-box w-full flex-nowrap overflow-x-auto bg-base-100">
        {VIEWS.map((view) => {
          const count = counts?.[view.id];
          return (
            <button
              key={view.id}
              type="button"
              role="tab"
              aria-selected={relevance === view.id}
              className={`tab shrink-0 flex-nowrap gap-2 whitespace-nowrap ${relevance === view.id ? "tab-active" : ""}`}
              onClick={() => onRelevanceChange?.(view.id)}
            >
              {view.label}
              {count !== undefined && count > 0 && (
                <span className={`badge badge-xs px-1.5 ${view.badge ?? "badge-ghost"}`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="select select-sm w-44"
          aria-label="Category"
          value={category ?? "all"}
          onChange={(e) => {
            const val = e.target.value;
            onCategoryChange(val === "all" ? undefined : val);
          }}
        >
          <option value="all">All categories</option>
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {CATEGORY_LABELS[cat]}
            </option>
          ))}
        </select>

        <select
          className="select select-sm w-36"
          aria-label="Urgency"
          value={minUrgency?.toString() ?? "all"}
          onChange={(e) => {
            const val = e.target.value;
            onUrgencyChange(val === "all" ? undefined : Number(val));
          }}
        >
          <option value="all">All urgency</option>
          <option value="5">Critical (5)</option>
          <option value="4">High (4+)</option>
          <option value="3">Medium (3+)</option>
          <option value="2">Low (2+)</option>
        </select>

        <select
          className="select select-sm w-28"
          aria-label="Status"
          value={status}
          disabled={relevance === "filtered" || relevance === "review"}
          onChange={(e) => onStatusChange(e.target.value as FeedStatus)}
        >
          <option value="new">New</option>
          <option value="handled">Handled</option>
          <option value="all">All</option>
        </select>

        {filtered && (
          <button
            type="button"
            className="btn btn-ghost btn-sm gap-1"
            onClick={() => {
              onCategoryChange(undefined);
              onUrgencyChange(undefined);
              onStatusChange("new");
            }}
          >
            <X className="size-3.5" aria-hidden />
            Clear filters
          </button>
        )}

        <span className="ml-auto inline-flex items-center gap-2 text-sm text-base-content/70">
          {busy && <span className="loading loading-spinner loading-xs" />}
          {postCount} posts
        </span>
      </div>
    </div>
  );
}
