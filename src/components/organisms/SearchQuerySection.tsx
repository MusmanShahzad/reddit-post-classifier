import { X } from "lucide-react";
import { AddItemInput } from "@/components/molecules";

/**
 * Settings section listing search queries (auto-generated and custom).
 *
 * Auto-generated queries are read-only; custom queries can be deleted.
 *
 * @param queries        - Array of search query objects.
 * @param onDeleteQuery  - Called with query ID to delete a custom query.
 * @param onAddQuery     - Called with query text to add a custom query.
 *
 * @example
 * ```tsx
 * <SearchQuerySection
 *   queries={company.searchQueries}
 *   onDeleteQuery={(id) => deleteQuery.mutate({ id })}
 *   onAddQuery={(q) => addCustomQuery.mutate({ companyId, query: q })}
 * />
 * ```
 */
export interface SearchQueryData {
  id: string;
  query: string;
  isCustom: boolean;
}

export interface SearchQuerySectionProps {
  queries: SearchQueryData[];
  onDeleteQuery: (id: string) => void;
  onAddQuery: (query: string) => void;
}

export function SearchQuerySection({
  queries,
  onDeleteQuery,
  onAddQuery,
}: SearchQuerySectionProps) {
  return (
    <div className="card card-border bg-base-100">
      <div className="card-body">
      <h3 className="card-title text-base">Search queries</h3>
      <div className="space-y-2">
        {queries.map((sq) => (
          <div
            key={sq.id}
            className="flex items-center justify-between rounded-box bg-base-200 px-3 py-2 text-sm"
          >
            <div className="flex items-center gap-2">
              <code>{sq.query}</code>
              {sq.isCustom && <span className="badge badge-outline badge-sm">custom</span>}
            </div>
            {sq.isCustom && (
              <button
                type="button"
                onClick={() => onDeleteQuery(sq.id)}
                className="btn btn-ghost btn-xs"
                aria-label="Remove query"
              >
                <X className="size-3" aria-hidden />
              </button>
            )}
          </div>
        ))}
      </div>

      <p className="text-xs text-base-content/60">
        Auto-generated queries update when you change keywords. Custom queries
        are preserved.
      </p>

      <AddItemInput
        placeholder="Add custom search query..."
        onAdd={onAddQuery}
      />
      </div>
    </div>
  );
}
