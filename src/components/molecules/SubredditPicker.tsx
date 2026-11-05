import { Check, Circle } from "lucide-react";
import { AddItemInput } from "./AddItemInput";

/**
 * Suggested subreddits that can be turned on and off, plus a box to add one.
 *
 * @param subreddits  - Subreddits with their selected state.
 * @param onToggle    - Called with the subreddit name when toggled.
 * @param onAddCustom - Called with the typed name, without the `r/` prefix.
 *
 * @example
 * ```tsx
 * <SubredditPicker
 *   subreddits={[{ name: "webdev", subscribers: 1200000, selected: true }]}
 *   onToggle={(name) => toggle(name)}
 *   onAddCustom={(name) => addCustom(name)}
 * />
 * ```
 */
export interface SubredditEntry {
  name: string;
  subscribers: number;
  selected: boolean;
}

export interface SubredditPickerProps {
  subreddits: SubredditEntry[];
  onToggle: (name: string) => void;
  onAddCustom: (name: string) => void;
}

function formatSubscribers(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(n);
}

export function SubredditPicker({ subreddits, onToggle, onAddCustom }: SubredditPickerProps) {
  return (
    <div className="space-y-2">
      {subreddits.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {subreddits.map((s) => (
            <button
              key={s.name}
              type="button"
              aria-pressed={s.selected}
              onClick={() => onToggle(s.name)}
              className={`flex items-center gap-2 rounded-box border p-2 text-left text-sm transition-colors duration-200 ${
                s.selected ? "border-base-content bg-base-100" : "border-base-300 bg-base-200 text-base-content/60"
              }`}
            >
              {s.selected ? (
                <Check className="size-4 shrink-0" aria-hidden />
              ) : (
                <Circle className="size-4 shrink-0 text-base-content/40" aria-hidden />
              )}
              <span className="font-medium">r/{s.name}</span>
              {s.subscribers > 0 && (
                <span className="ml-auto text-xs text-base-content/60" title={`${s.subscribers.toLocaleString()} members`}>
                  {formatSubscribers(s.subscribers)} members
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      <AddItemInput
        placeholder="Add a subreddit"
        onAdd={onAddCustom}
        transform={(value) => value.replace(/^\/?r\//i, "")}
      />
    </div>
  );
}
