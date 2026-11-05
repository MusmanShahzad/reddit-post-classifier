import { Check, ExternalLink, RotateCcw, X } from "lucide-react";

/**
 * Action buttons for a single post card: Mark Handled, Dismiss, Reopen, and a Reddit link.
 *
 * The visible buttons depend on the current `status` of the post.
 *
 * @param status    - Current post status (`"new"` or `"handled"`).
 * @param permalink - Full URL to the Reddit post.
 * @param onHandle  - Marks the post as handled.
 * @param onDismiss - Dismisses the post (hides from feed).
 * @param onReopen  - Moves a handled post back to "new".
 * @param disabled  - Disables mutation buttons (e.g. while a mutation is in flight).
 *
 * @example
 * ```tsx
 * <PostActions
 *   status="new"
 *   permalink="https://reddit.com/r/example/abc"
 *   onHandle={() => mutate({ status: "handled" })}
 *   onDismiss={() => mutate({ status: "dismissed" })}
 *   onReopen={() => mutate({ status: "new" })}
 * />
 * ```
 */
export interface PostActionsProps {
  status: string;
  permalink: string;
  onHandle: () => void;
  onDismiss: () => void;
  onReopen: () => void;
  disabled?: boolean;
}

export function PostActions({
  status,
  permalink,
  onHandle,
  onDismiss,
  onReopen,
  disabled = false,
}: PostActionsProps) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      {status === "new" && (
        <>
          <button type="button" className="btn btn-sm" onClick={onHandle} disabled={disabled}>
            <Check className="size-4" aria-hidden />
            Mark handled
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onDismiss} disabled={disabled}>
            <X className="size-4" aria-hidden />
            Dismiss
          </button>
        </>
      )}
      {status === "review" && (
        <>
          <button type="button" className="btn btn-sm" onClick={onReopen} disabled={disabled}>
            <Check className="size-4" aria-hidden />
            Keep in feed
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onDismiss} disabled={disabled}>
            <X className="size-4" aria-hidden />
            Not relevant
          </button>
        </>
      )}
      {status === "handled" && (
        <button type="button" className="btn btn-sm btn-ghost" onClick={onReopen} disabled={disabled}>
          <RotateCcw className="size-4" aria-hidden />
          Reopen
        </button>
      )}
      <a
        href={permalink}
        target="_blank"
        rel="noopener noreferrer"
        className="link link-hover ml-auto inline-flex items-center gap-1 text-sm"
      >
        <ExternalLink className="size-3.5" aria-hidden />
        Open on Reddit
      </a>
    </div>
  );
}
