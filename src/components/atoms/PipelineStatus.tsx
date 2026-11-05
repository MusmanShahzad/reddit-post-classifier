/**
 * Live pipeline step indicator for the onboarding chat.
 *
 * Shows each guardrail / extraction layer as a row with a status icon,
 * label, and elapsed time — making the AI pipeline transparent to users.
 *
 * @param steps - Array of pipeline step objects with id, label, and status.
 *
 * @example
 * ```tsx
 * <PipelineStatus steps={[
 *   { id: "moderation", label: "Content safety", status: "done" },
 *   { id: "guardrails", label: "Business check", status: "running" },
 *   { id: "extraction", label: "Extracting config", status: "pending" },
 * ]} />
 * ```
 */

import { Check, Circle, LoaderCircle, Minus, X, type LucideIcon } from "lucide-react";

export type StepStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface PipelineStep {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

export interface PipelineStatusProps {
  steps: PipelineStep[];
}

const statusConfig: Record<StepStatus, { Icon: LucideIcon; color: string; animate?: string }> = {
  pending:  { Icon: Circle, color: "text-base-content/30" },
  running:  { Icon: LoaderCircle, color: "text-info", animate: "animate-spin" },
  done:     { Icon: Check, color: "text-success" },
  error:    { Icon: X, color: "text-error" },
  skipped:  { Icon: Minus, color: "text-base-content/40" },
};

export function PipelineStatus({ steps }: PipelineStatusProps) {
  return (
    <div className="chat chat-start">
      <div className="chat-bubble">
        <div className="space-y-1.5">
          {steps.map((step) => {
            const cfg = statusConfig[step.status];
            return (
              <div key={step.id} className="flex items-center gap-2 text-xs">
                <cfg.Icon className={`size-3.5 ${cfg.color} ${cfg.animate ?? ""}`} aria-hidden />
                <span className={step.status === "running" ? "font-medium" : "text-base-content/70"}>
                  {step.label}
                </span>
                {step.detail && (
                  <span className="text-base-content/50">— {step.detail}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
