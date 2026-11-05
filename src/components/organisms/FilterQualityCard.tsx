import type { CSSProperties } from "react";
import { ShieldCheck } from "lucide-react";
import { AnimatedNumber, AnimatedProgress, AnimatedText, useAnimatedNumber } from "@/components/atoms";
import type { FilterQuality } from "@/lib/filter-checks";

export interface FilterQualityCardProps {
  quality: FilterQuality | null;
  reviewCount: number;
  onOpenReview?: () => void;
  /** Opens the optional brief questions when some are still unanswered. */
  onCompleteBrief?: () => void;
}

function tone(value: number): string {
  if (value >= 0.85) return "progress-success";
  if (value >= 0.6) return "progress-warning";
  return "progress-error";
}

/** How much the filter can be trusted, from saved posts and the user's own actions. */
export function FilterQualityCard({ quality, reviewCount, onOpenReview, onCompleteBrief }: FilterQualityCardProps) {
  const score = quality?.score ?? null;
  const shownScore = useAnimatedNumber(score ?? 0);
  const brief = quality?.metrics.find((metric) => metric.id === "brief");
  const briefOpen = brief?.value !== null && brief?.value !== undefined && brief.value < 1;
  return (
    <section className="card card-border bg-base-100">
      <div className="card-body gap-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="card-title text-base">
              <ShieldCheck className="size-4" aria-hidden />
              Filter quality
            </h2>
            <p className="text-sm text-base-content/70">
              Posts are shown only when the score passes clearly and nothing conflicts with what you
              asked to find. Anything unsure waits for your review.
            </p>
          </div>
          {score !== null ? (
            <div
              className={`radial-progress shrink-0 text-sm font-semibold ${score >= 85 ? "text-success" : score >= 60 ? "text-warning" : "text-error"}`}
              style={{ "--value": shownScore, "--size": "4rem" } as CSSProperties}
              role="progressbar"
              aria-valuenow={score}
              aria-label="Filter quality score"
            >
              <span className="tabular-nums">{Math.round(shownScore)}</span>
            </div>
          ) : (
            <span className="badge badge-ghost shrink-0">{quality?.warning ? "No score yet" : "No data yet"}</span>
          )}
        </div>

        {quality?.warning && (
          <div role="status" className="card card-border border-l-4 border-l-warning p-3 text-sm">
            {quality.warning}
          </div>
        )}

        <ul className="space-y-3">
          {(quality?.metrics ?? []).map((metric) => (
            <li key={metric.id} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>{metric.label}</span>
                <span className="font-medium tabular-nums">
                  {metric.value === null ? "—" : <AnimatedNumber value={Math.round(metric.value * 100)} suffix="%" />}
                </span>
              </div>
              {metric.value !== null && (
                <AnimatedProgress
                  className={`progress h-1.5 w-full ${tone(metric.value)}`}
                  value={Math.round(metric.value * 100)}
                  max={100}
                />
              )}
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-base-content/60">
                  <AnimatedText text={metric.detail} />
                </p>
                {metric.id === "brief" && briefOpen && onCompleteBrief && (
                  <button type="button" className="btn btn-xs" onClick={onCompleteBrief}>
                    Complete brief
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>

        {reviewCount > 0 && (
          <div role="status" className="alert alert-warning alert-soft">
            <span>
              <AnimatedNumber value={reviewCount} /> {reviewCount === 1 ? "post needs" : "posts need"} your check before they show in the feed.
            </span>
            {onOpenReview && (
              <button type="button" className="btn btn-sm" onClick={onOpenReview}>
                Review
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
