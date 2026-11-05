import { Inbox } from "lucide-react";

/**
 * A placeholder card shown when a list or section has no data to display.
 *
 * @param title   - Primary message (e.g. "No posts matching your filters.").
 * @param message - Optional secondary helper text.
 *
 * @example
 * ```tsx
 * <EmptyState
 *   title="No posts matching your filters."
 *   message="Try adjusting the filters or run a new collection."
 * />
 * ```
 */
export interface EmptyStateProps {
  title: string;
  message?: string;
}

export function EmptyState({ title, message }: EmptyStateProps) {
  return (
    <div className="card card-border bg-base-100">
      <div className="card-body items-center text-center">
        <Inbox className="size-8 text-base-content/40" aria-hidden />
        <p className="text-lg">{title}</p>
        {message && <p className="text-sm text-base-content/70">{message}</p>}
      </div>
    </div>
  );
}
