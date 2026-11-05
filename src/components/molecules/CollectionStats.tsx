/**
 * A two-column key/value grid showing stats from the last collection run.
 *
 * Displayed inside the Collection Status card on the Dashboard.
 *
 * @param startedAt    - ISO timestamp of when the run started.
 * @param totalFetched - Number of raw Reddit posts fetched.
 * @param totalNew     - Number of posts that passed deduplication.
 * @param totalRelevant - Number of posts classified as relevant.
 *
 * @example
 * ```tsx
 * <CollectionStats
 *   startedAt="2024-03-15T10:30:00Z"
 *   totalFetched={240}
 *   totalNew={38}
 *   totalRelevant={12}
 * />
 * ```
 */
export interface CollectionStatsProps {
  startedAt: string | Date;
  totalFetched: number;
  totalNew: number;
  totalRelevant: number;
}

export function CollectionStats({
  startedAt,
  totalFetched,
  totalNew,
  totalRelevant,
}: CollectionStatsProps) {
  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <div className="text-base-content/60">Last run:</div>
      <div className="font-medium">{new Date(startedAt).toLocaleString()}</div>
      <div className="text-base-content/60">Posts found:</div>
      <div className="font-medium">{totalFetched}</div>
      <div className="text-base-content/60">New posts:</div>
      <div className="font-medium">{totalNew}</div>
      <div className="text-base-content/60" title="Passed the filter: in the feed, or held for your check">Kept:</div>
      <div className="font-medium">{totalRelevant}</div>
    </div>
  );
}
