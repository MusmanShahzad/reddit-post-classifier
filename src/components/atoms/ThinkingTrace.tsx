import { useEffect, useState } from "react";
import { Check, ChevronDown, LoaderCircle, Minus, X, type LucideIcon } from "lucide-react";
import type { PipelineStep, StepStatus } from "./PipelineStatus";

/**
 * What the assistant is doing, shown live above its reply. While the turn
 * runs it stays open and the header shows the current action. When the
 * turn ends it folds into one line ("Worked for 3s") that can be reopened.
 *
 * @param steps      - Pipeline steps with their live status.
 * @param activity   - Plain sentences in the order they happened, each tied
 *                     to the step that was under way when it was said.
 * @param running    - True until the turn finishes.
 * @param writing    - True while the reply text is arriving.
 * @param durationMs - How long the finished turn took.
 */
export interface TraceNote {
  stepId?: string;
  text: string;
}

export interface ThinkingTraceProps {
  steps: PipelineStep[];
  activity?: TraceNote[];
  running: boolean;
  writing?: boolean;
  durationMs?: number;
}

const ICONS: Record<StepStatus, { Icon: LucideIcon; className: string }> = {
  pending: { Icon: Minus, className: "text-base-content/30" },
  running: { Icon: LoaderCircle, className: "animate-spin text-primary" },
  done: { Icon: Check, className: "text-success" },
  error: { Icon: X, className: "text-error" },
  skipped: { Icon: Minus, className: "text-base-content/30" },
};

export function ThinkingTrace({ steps, activity = [], running, writing = false, durationMs }: ThinkingTraceProps) {
  const [open, setOpen] = useState(running);

  useEffect(() => {
    setOpen(running);
  }, [running]);

  const failed = steps.find((step) => step.status === "error");
  const runningStep = steps.find((step) => step.status === "running");
  const current = writing ? "Writing the reply" : (activity.at(-1)?.text ?? runningStep?.label ?? "Starting");
  const seconds = Math.max(1, Math.round((durationMs ?? 0) / 1000));
  const summary = failed ? `Stopped at ${failed.label.toLowerCase()}` : `Worked for ${seconds}s`;
  const visibleSteps = steps.filter((step) => step.status !== "pending" && step.status !== "skipped");
  const notesFor = (stepId?: string) => activity.filter((note) => note.stepId === stepId);
  const loose = activity.filter((note) => !note.stepId || !visibleSteps.some((step) => step.id === note.stepId));

  return (
    <div className="mb-2 text-sm">
      <button
        type="button"
        className="group inline-flex max-w-full items-center gap-2 rounded-lg py-1 text-base-content/60 transition-colors hover:text-base-content"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {running ? (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden />
        ) : failed ? (
          <X className="size-3.5 shrink-0 text-error" aria-hidden />
        ) : (
          <Check className="size-3.5 shrink-0 text-success" aria-hidden />
        )}
        <span className={`truncate ${running ? "text-shimmer font-medium" : ""}`} aria-live="polite">
          {running ? current : summary}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
      >
        <div className="overflow-hidden">
          <ol className="ml-1.5 mt-1 space-y-1.5 border-l border-base-300 pb-1 pl-4">
            {visibleSteps.map((step) => {
              const { Icon, className } = ICONS[step.status];
              return (
                <li key={step.id} className="animate-rise-in">
                  <div className="flex items-center gap-2">
                    <Icon className={`size-3.5 shrink-0 ${className}`} aria-hidden />
                    <span className={step.status === "running" ? "text-base-content" : "text-base-content/70"}>
                      {step.label}
                    </span>
                    {step.detail && <span className="text-base-content/45">· {step.detail}</span>}
                  </div>
                  {notesFor(step.id).map((note, index) => (
                    <p key={`${index}-${note.text}`} className="animate-rise-in ml-5.5 mt-0.5 text-xs text-base-content/50">
                      {note.text}
                    </p>
                  ))}
                </li>
              );
            })}
            {loose.map((note, index) => (
              <li key={`${index}-${note.text}`} className="animate-rise-in text-base-content/55">
                {note.text}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
