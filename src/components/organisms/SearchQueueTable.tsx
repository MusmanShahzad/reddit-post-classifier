import { droppedPosts } from "@/lib/search-stats";

const STATUS_BADGE: Record<string, string> = {
  pending: "badge-ghost",
  running: "badge-info",
  waiting: "badge-warning",
  done: "badge-success",
  failed: "badge-error",
  skipped: "badge-ghost",
  queued: "badge-warning",
};

export interface SearchQueueRow {
  id?: string;
  query: string;
  status: string;
  fetchedCount: number;
  newCount: number;
  duplicateCount: number;
  relevantCount: number;
  filteredCount: number;
  error?: string | null;
}

/**
 * One row per search job. Fetched always equals New + Duplicates + Dropped.
 * Kept and Filtered are counted separately, because they include posts this
 * search found again, so they can add up to more than New.
 */
export function SearchQueueTable({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: SearchQueueRow[];
  empty: string;
}) {
  return (
    <div className="card card-border bg-base-100">
      <div className="card-body">
        <h3 className="card-title text-base">{title}</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-base-content/70">{empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Search</th>
                  <th>Status</th>
                  <th>Fetched</th>
                  <th>New</th>
                  <th title="Already saved, by this run or an earlier one">Duplicates</th>
                  <th title="The search returned these, but they never use the tracked name, so they were not kept">Dropped</th>
                  <th title="Passed the filter: in the feed, or held for your check. Includes posts found again, so this can be higher than New">Kept</th>
                  <th title="Includes posts found again, so this can be higher than New">Filtered</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id ?? row.query}>
                    <td className="max-w-sm whitespace-normal">
                      <code>{row.query}</code>
                      {row.error && (
                        <p className={`text-xs ${row.status === "waiting" ? "text-base-content/70" : "text-error"}`}>
                          {row.error}
                        </p>
                      )}
                    </td>
                    <td>
                      <span className={`badge badge-sm gap-1 ${STATUS_BADGE[row.status] ?? "badge-ghost"}`}>
                        {row.status === "running" && <span className="loading loading-spinner size-3" aria-hidden />}
                        {row.status}
                      </span>
                    </td>
                    <td>{row.fetchedCount}</td>
                    <td>{row.newCount}</td>
                    <td>{row.duplicateCount}</td>
                    <td>{droppedPosts(row)}</td>
                    <td>{row.relevantCount}</td>
                    <td>{row.filteredCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
