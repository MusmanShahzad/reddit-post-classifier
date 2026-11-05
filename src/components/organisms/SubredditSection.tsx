import { TagList } from "@/components/molecules";
import { AddItemInput } from "@/components/molecules";

/**
 * Settings section managing monitored subreddits.
 *
 * Displays existing subreddits as removable tags and provides an input to add
 * new ones (auto-strips `r/` prefix).
 *
 * @param subreddits   - Array of subreddit objects with `id` and `name`.
 * @param onRemove     - Called with subreddit ID to remove.
 * @param onAdd        - Called with subreddit name to add.
 *
 * @example
 * ```tsx
 * <SubredditSection
 *   subreddits={company.subreddits}
 *   onRemove={(id) => removeSubreddit.mutate({ id })}
 *   onAdd={(name) => addSubreddit.mutate({ companyId, name })}
 * />
 * ```
 */
export interface SubredditData {
  id: string;
  name: string;
}

export interface SubredditSectionProps {
  subreddits: SubredditData[];
  onRemove: (id: string) => void;
  onAdd: (name: string) => void;
}

export function SubredditSection({
  subreddits,
  onRemove,
  onAdd,
}: SubredditSectionProps) {
  return (
    <div className="card card-border bg-base-100">
      <div className="card-body">
      <h3 className="card-title text-base">Subreddits</h3>
      <div className="mb-3">
        <TagList
          tags={subreddits.map((sub) => ({
            label: `r/${sub.name}`,
            variant: "outline" as const,
            onRemove: () => onRemove(sub.id),
          }))}
        />
      </div>
      <AddItemInput
        placeholder="Add subreddit..."
        onAdd={onAdd}
        transform={(v) => v.replace(/^r\//, "")}
      />
      </div>
    </div>
  );
}
