import { useState } from "react";
import { Check, Plus, Radar, Trash2, X } from "lucide-react";
import { AnimatedNumber, AnimatedText } from "@/components/atoms";

/**
 * Sidebar list of monitoring sessions. Each session has its own brief,
 * searches, and posts. Click one to show it; delete asks once to confirm.
 *
 * @param sessions - Sessions to list, newest first.
 * @param activeId - The session being shown.
 * @param onSelect - Fires with the chosen session ID.
 * @param onCreate - Starts a new session.
 * @param onDelete - Fires with the session ID after the user confirms.
 * @param creating - True while the new-session chat is open.
 * @param busy     - Disables the list while a switch or delete is saving.
 */
export interface SessionSummary {
  id: string;
  label: string;
  keepWhen: string;
  relevant: number;
  /** Posts held for a person to check. They are not counted as relevant until kept. */
  toCheck?: number;
  posts: number;
  /** Relevant posts that arrived since this session's feed was last opened. */
  newPosts?: number;
  /** What the session's run is doing right now. */
  runState?: "collecting" | "waiting" | "queued" | null;
}

const RUN_BADGE = {
  collecting: { label: "Collecting", style: "badge-info badge-soft" },
  waiting: { label: "Waiting", style: "badge-warning badge-soft" },
  queued: { label: "Queued", style: "badge-ghost" },
};

export interface SessionSwitcherProps {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  creating?: boolean;
  busy?: boolean;
}

export function SessionSwitcher({
  sessions,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  creating = false,
  busy = false,
}: SessionSwitcherProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-base-content/60">Sessions</span>
        <button
          type="button"
          className={`btn btn-xs ${creating ? "btn-primary" : "btn-ghost"} gap-1`}
          onClick={onCreate}
          disabled={busy}
        >
          <Plus className="size-3.5" aria-hidden />
          New
        </button>
      </div>

      <ul className="menu w-full gap-1 p-0">
        {sessions.map((session) => {
          const active = !creating && session.id === activeId;
          const confirming = confirmId === session.id;
          return (
            <li key={session.id}>
              <div
                className={`group flex items-start gap-2 ${active ? "menu-active" : ""}`}
                role="button"
                tabIndex={0}
                aria-current={active ? "true" : undefined}
                aria-disabled={busy}
                onClick={() => !busy && !confirming && onSelect(session.id)}
                onKeyDown={(event) => {
                  if ((event.key === "Enter" || event.key === " ") && !busy && !confirming) {
                    event.preventDefault();
                    onSelect(session.id);
                  }
                }}
              >
                <Radar className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{session.label}</span>
                    {Boolean(session.newPosts) && (
                      <span
                        className="badge badge-primary badge-xs shrink-0 animate-rise-in px-1.5"
                        data-testid="session-new-badge"
                        title={`${session.newPosts} new relevant ${session.newPosts === 1 ? "post" : "posts"}`}
                        aria-label={`${session.newPosts} new`}
                      >
                        <AnimatedNumber value={session.newPosts ?? 0} />
                      </span>
                    )}
                  </div>
                  {session.keepWhen && (
                    <div className="line-clamp-2 text-xs opacity-70">{session.keepWhen}</div>
                  )}
                  <div className="text-xs opacity-60">
                    <AnimatedNumber value={session.relevant ?? 0} /> relevant
                    {session.toCheck ? <> · <AnimatedNumber value={session.toCheck} /> to check</> : null}
                    {" · "}<AnimatedNumber value={session.posts ?? 0} /> saved
                  </div>
                  {session.runState && (
                    <span className={`badge badge-xs mt-1 gap-1 ${RUN_BADGE[session.runState].style}`}>
                      {session.runState === "collecting" && <span className="loading loading-spinner size-2" aria-hidden />}
                      <AnimatedText text={RUN_BADGE[session.runState].label} />
                    </span>
                  )}
                </div>

                {confirming ? (
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      className="btn btn-error btn-xs btn-square"
                      aria-label={`Confirm delete ${session.label}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setConfirmId(null);
                        onDelete(session.id);
                      }}
                    >
                      <Check className="size-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs btn-square"
                      aria-label="Cancel delete"
                      onClick={(event) => {
                        event.stopPropagation();
                        setConfirmId(null);
                      }}
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-square shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                    aria-label={`Delete ${session.label}`}
                    disabled={busy}
                    onClick={(event) => {
                      event.stopPropagation();
                      setConfirmId(session.id);
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {confirmId && (
        <p className="px-2 text-xs text-error">
          Deleting removes this session&apos;s posts, searches, and logs.
        </p>
      )}
    </div>
  );
}
