import { AddItemInput, SubredditPicker, type SubredditEntry } from "@/components/molecules";
import { RemovableTag } from "@/components/atoms";

/**
 * The last step of a new session: everything that will be searched, with
 * competitors, topics, and subreddits editable before monitoring starts.
 *
 * @param config             - The setup to save.
 * @param subreddits         - Suggested subreddits with their selected state.
 * @param onToggleSubreddit  - Called when a subreddit is toggled.
 * @param onAddSubreddit     - Called when a subreddit is typed in.
 * @param onAddCompetitor    - Adds a competitor.
 * @param onRemoveCompetitor - Removes a competitor.
 * @param onAddTopic         - Adds a topic.
 * @param onRemoveTopic      - Removes a topic.
 * @param onConfirm          - Called when the user clicks "Start monitoring".
 * @param onStartOver        - Optional. Goes back to the details form.
 * @param isSaving           - Disables the button while saving.
 *
 * @example
 * ```tsx
 * <ConfigReviewCard config={config} subreddits={subreddits} onConfirm={save} isSaving={false} ... />
 * ```
 */
export interface OnboardingConfig {
  companyName: string;
  product?: string;
  buyer?: string;
  keepWhen?: string;
  notAbout?: string;
  brandKeywords: Array<{ value: string; aliases: string[] }>;
  competitorKeywords: Array<{ value: string }>;
  topicKeywords: Array<{ value: string }>;
}

export interface ConfigReviewCardProps {
  config: OnboardingConfig;
  subreddits: SubredditEntry[];
  onToggleSubreddit: (name: string) => void;
  onAddSubreddit: (name: string) => void;
  onAddCompetitor: (value: string) => void;
  onRemoveCompetitor: (value: string) => void;
  onAddTopic: (value: string) => void;
  onRemoveTopic: (value: string) => void;
  onConfirm: () => void;
  /** Goes back to the details form. */
  onStartOver?: () => void;
  isSaving: boolean;
}

export function ConfigReviewCard({
  config,
  subreddits,
  onToggleSubreddit,
  onAddSubreddit,
  onAddCompetitor,
  onRemoveCompetitor,
  onAddTopic,
  onRemoveTopic,
  onConfirm,
  onStartOver,
  isSaving,
}: ConfigReviewCardProps) {
  const brief = [
    { label: "Company", value: config.companyName },
    { label: "Sells", value: config.product },
    { label: "Find", value: config.keepWhen },
    { label: "Buyers", value: config.buyer },
    { label: "Skip", value: config.notAbout },
  ].filter((row) => row.value?.trim());
  const brands = config.brandKeywords.flatMap((brand) => [brand.value, ...brand.aliases]);
  const picked = subreddits.filter((sub) => sub.selected).length;

  return (
    <section className="card card-border bg-base-100">
      <div className="card-body gap-5 text-sm">
        <div>
          <h2 className="card-title text-base">Review your setup</h2>
          <p className="text-base-content/70">
            Check what will be searched. Remove anything that does not fit, or add what is missing.
          </p>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          {brief.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-base-content/60">{row.label}</dt>
              <dd className="font-medium">{row.value}</dd>
            </div>
          ))}
          {brands.length > 0 && (
            <div className="contents">
              <dt className="text-base-content/60">Brand names</dt>
              <dd className="flex flex-wrap gap-1">
                {brands.map((name) => (
                  <span key={name} className="badge badge-ghost">
                    {name}
                  </span>
                ))}
              </dd>
            </div>
          )}
        </dl>

        <div className="divider my-0" />

        <KeywordEditor
          label="Competitors"
          hint="A few businesses in the same niche. Each name is searched across all of Reddit."
          empty="No direct competitor could be named with confidence. Add any you know, because competitor posts are only searched for by name."
          placeholder="Add a competitor"
          values={config.competitorKeywords.map((item) => item.value)}
          onAdd={onAddCompetitor}
          onRemove={onRemoveCompetitor}
        />

        <KeywordEditor
          label="Topics"
          hint="How buyers describe the product. These find potential customers who name no company."
          empty="No topics yet."
          placeholder="Add a topic"
          values={config.topicKeywords.map((item) => item.value)}
          onAdd={onAddTopic}
          onRemove={onRemoveTopic}
        />

        <div className="space-y-2">
          <div>
            <h3 className="font-medium">
              Subreddits <span className="text-base-content/60">· {picked} selected</span>
            </h3>
            <p className="text-xs text-base-content/60">
              {subreddits.length > 0
                ? "Tap one to leave it out. The number is how many members it has."
                : "None were suggested. Add the ones where these posts happen."}
            </p>
          </div>
          <SubredditPicker subreddits={subreddits} onToggle={onToggleSubreddit} onAddCustom={onAddSubreddit} />
        </div>

        <div className="card-actions justify-end">
          {onStartOver && (
            <button type="button" className="btn btn-ghost" onClick={onStartOver} disabled={isSaving}>
              Start over
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={isSaving}>
            {isSaving && <span className="loading loading-spinner loading-xs" />}
            {isSaving ? "Saving" : "Start monitoring"}
          </button>
        </div>
      </div>
    </section>
  );
}

function KeywordEditor({
  label,
  hint,
  empty,
  placeholder,
  values,
  onAdd,
  onRemove,
}: {
  label: string;
  hint: string;
  empty: string;
  placeholder: string;
  values: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="font-medium">{label}</h3>
        <p className="text-xs text-base-content/60">{hint}</p>
      </div>
      <div className="flex flex-wrap gap-1">
        {values.length === 0 && <span className="text-base-content/60">{empty}</span>}
        {values.map((value) => (
          <RemovableTag key={value} label={value} variant="outline" onRemove={() => onRemove(value)} />
        ))}
      </div>
      <AddItemInput placeholder={placeholder} onAdd={onAdd} />
    </div>
  );
}
