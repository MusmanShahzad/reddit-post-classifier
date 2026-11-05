"use client";

import { useState } from "react";
import { api } from "@/trpc/react";
import { droppedPosts } from "@/lib/search-stats";
import { readableError } from "@/lib/trpc-error";
import { SettingsSkeleton } from "@/components/atoms";
import {
  KeywordSection,
  SubredditSection,
  SearchQuerySection,
} from "@/components/organisms";
import { BriefEditor } from "./brief-editor";

export function Settings() {
  const { data: company, isLoading, refetch } = api.settings.getCompany.useQuery();
  const [editingBrief, setEditingBrief] = useState(false);
  const utils = api.useUtils();
  // Tags drive the searches, so the tag table and the cost estimate change with them.
  const refresh = () => {
    void refetch();
    void utils.settings.getTagPerformance.invalidate();
    void utils.collector.getSchedule.invalidate();
  };
  const addKeyword = api.settings.addKeyword.useMutation({ onSuccess: refresh });
  const deleteKeyword = api.settings.deleteKeyword.useMutation({ onSuccess: refresh });
  const updateKeyword = api.settings.updateKeyword.useMutation({ onSuccess: refresh });
  const addSubreddit = api.settings.addSubreddit.useMutation({ onSuccess: refresh });
  const removeSubreddit = api.settings.removeSubreddit.useMutation({ onSuccess: refresh });
  const addCustomQuery = api.settings.addCustomQuery.useMutation({ onSuccess: refresh });
  const deleteQuery = api.settings.deleteSearchQuery.useMutation({ onSuccess: refresh });
  const editError = readableError(
    addKeyword.error ??
      deleteKeyword.error ??
      updateKeyword.error ??
      addSubreddit.error ??
      removeSubreddit.error ??
      addCustomQuery.error ??
      deleteQuery.error,
  );

  if (isLoading) {
    return <SettingsSkeleton />;
  }

  if (!company) {
    return (
      <div className="py-12 text-center text-base-content/70">
        No session yet. Start a new session from the sidebar.
      </div>
    );
  }

  const brands = company.keywords.filter((k) => k.type === "brand");
  const competitors = company.keywords.filter((k) => k.type === "competitor");
  const topics = company.keywords.filter((k) => k.type === "topic");

  return (
    <div className="space-y-6 py-4">
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-bold">Settings</h2>
          <p className="text-sm text-base-content/70">What is searched for {company.name}.</p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {[
            { label: "Sells", value: company.product },
            { label: "Find", value: company.keepWhen },
            { label: "Buyers", value: company.buyer },
            { label: "Skip", value: company.notAbout },
          ].map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-base-content/60">{row.label}</dt>
              <dd className={row.value.trim() ? "" : "text-base-content/50"}>{row.value.trim() || "Not answered yet"}</dd>
            </div>
          ))}
        </dl>
        <button type="button" className="btn btn-sm" onClick={() => setEditingBrief(true)}>
          {company.buyer.trim() && company.notAbout.trim() ? "Edit buyers and skip" : "Complete brief"}
        </button>
        {editingBrief && <BriefEditor onClose={() => setEditingBrief(false)} />}
      </div>

      {editError && (
        <div role="alert" className="alert alert-error alert-soft">
          <span>{editError}</span>
        </div>
      )}

      <ScheduleSection />
      <AuthorLookupsSection />
      <TagPerformance />

      <KeywordSection
        brands={brands}
        competitors={competitors}
        topics={topics}
        onDeleteKeyword={(id) => deleteKeyword.mutate({ id })}
        onAddKeyword={(type, value) =>
          addKeyword.mutate({ companyId: company.id, type, value })
        }
        onChangeAliases={(id, aliases) => updateKeyword.mutate({ id, aliases })}
      />

      <SubredditSection
        subreddits={company.subreddits}
        onRemove={(id) => removeSubreddit.mutate({ id })}
        onAdd={(name) =>
          addSubreddit.mutate({ companyId: company.id, name })
        }
      />

      <SearchQuerySection
        queries={company.searchQueries}
        onDeleteQuery={(id) => deleteQuery.mutate({ id })}
        onAddQuery={(query) =>
          addCustomQuery.mutate({ companyId: company.id, query })
        }
      />
    </div>
  );
}

function TagPerformance() {
  const { data } = api.settings.getTagPerformance.useQuery();
  if (!data) return null;

  return (
    <div className="card card-border bg-base-100">
      <div className="card-body">
        <h3 className="card-title text-base">How tags are doing</h3>
        <p className="text-sm text-base-content/70">
          Strong tags bring relevant posts. Weak tags are fetched but almost none pass the filter.
          Remove or replace a weak tag in the lists below, and the next run uses the new search.
        </p>
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Tag</th>
                <th>Type</th>
                <th>Verdict</th>
                <th>Fetched</th>
                <th>New</th>
                <th title="Passed the filter: in the feed, or held for your check">Kept</th>
                <th>Filtered</th>
              </tr>
            </thead>
            <tbody>
              {data.keywords.map((keyword) => (
                <tr key={keyword.id}>
                  <td>{keyword.value}</td>
                  <td>{keyword.type}</td>
                  <td><VerdictBadge verdict={keyword.verdict} /></td>
                  <td>{keyword.fetched}</td>
                  <td>{keyword.fresh}</td>
                  <td>{keyword.relevant}</td>
                  <td>{keyword.filtered}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.queries.length > 0 && (
          <div className="overflow-x-auto">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Search</th>
                  <th>Verdict</th>
                  <th>Done</th>
                  <th>Skipped</th>
                  <th>Failed</th>
                  <th>Fetched</th>
                  <th>New</th>
                  <th>Duplicates</th>
                  <th title="The search returned these, but they never use the tracked name, so they were not kept">Dropped</th>
                  <th title="Passed the filter: in the feed, or held for your check">Kept</th>
                </tr>
              </thead>
              <tbody>
                {data.queries.map((query) => (
                  <tr key={query.query}>
                    <td className="max-w-sm whitespace-normal"><code>{query.query}</code></td>
                    <td><VerdictBadge verdict={query.verdict} /></td>
                    <td>{query.done}</td>
                    <td>{query.skipped}</td>
                    <td>{query.failed}</td>
                    <td>{query.fetched}</td>
                    <td>{query.fresh}</td>
                    <td>{query.duplicates}</td>
                    <td>{droppedPosts({ fetchedCount: query.fetched, newCount: query.fresh, duplicateCount: query.duplicates })}</td>
                    <td>{query.relevant}</td>
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

const VERDICTS: Record<string, { label: string; style: string; hint: string }> = {
  strong: { label: "Strong", style: "badge-success", hint: "At least 1 in 5 new posts is relevant" },
  mixed: { label: "Mixed", style: "badge-warning", hint: "Some relevant posts, mostly noise" },
  weak: { label: "Weak", style: "badge-error", hint: "Many posts checked and none relevant" },
  early: { label: "Too early", style: "badge-info", hint: "Fewer than 5 posts checked so far" },
  empty: { label: "No posts", style: "badge-ghost", hint: "The search worked and found nothing" },
  failed: { label: "Failing", style: "badge-error", hint: "Every attempt errored. Edit or remove it" },
  not_run: { label: "Not run", style: "badge-ghost", hint: "Waiting for its first run" },
};

function VerdictBadge({ verdict }: { verdict: string }) {
  const info = VERDICTS[verdict] ?? VERDICTS.not_run!;
  return (
    <span className={`badge badge-sm ${info.style}`} title={info.hint}>
      {info.label}
    </span>
  );
}

const DEFAULT_LOOKUPS_PER_RUN = 25;

function AuthorLookupsSection() {
  const { data } = api.settings.getSettings.useQuery();
  const { data: schedule } = api.collector.getSchedule.useQuery();
  const utils = api.useUtils();
  const [draft, setDraft] = useState<number | null>(null);
  const update = api.settings.updateSettings.useMutation({
    onSuccess: async () => {
      await utils.settings.getSettings.invalidate();
      setDraft(null);
    },
  });
  const enabled = data?.authorLookupsEnabled !== false;
  const perRun = draft ?? data?.authorLookupsPerRun ?? DEFAULT_LOOKUPS_PER_RUN;
  const updateError = readableError(update.error);

  return (
    <div className="card card-border bg-base-100">
      <div className="card-body">
        <h3 className="card-title text-base">Author profiles</h3>
        <p className="text-sm text-base-content/70">
          Fetches the profile picture, name, karma, and account age of people behind relevant posts.
          Each person is looked up once, for {schedule?.creditsPerLookup ?? 5} credits.
          {enabled && ` At this limit a run spends at most ${(perRun || 0) * (schedule?.creditsPerLookup ?? 5)} credits on lookups, usually far fewer.`}
        </p>
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="toggle"
            aria-label="Look up author profiles"
            checked={enabled}
            disabled={update.isPending}
            onChange={(event) => update.mutate({ authorLookupsEnabled: event.target.checked })}
          />
          <span>
            Look up author profiles
            <span className="block text-base-content/70">
              {enabled
                ? "New authors are looked up after each run's searches finish."
                : "Off. No paid lookups are sent. Profiles already saved still show, and other authors show their username."}
            </span>
          </span>
        </label>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const next = Number.isFinite(perRun) ? Math.min(200, Math.max(1, Math.round(perRun))) : DEFAULT_LOOKUPS_PER_RUN;
            update.mutate({ authorLookupsPerRun: next });
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            Most lookups per run
            <input
              type="number"
              min={1}
              max={200}
              className="input w-32"
              value={perRun}
              disabled={!enabled}
              onChange={(event) => setDraft(Number(event.target.value))}
            />
          </label>
          <button type="submit" className="btn" disabled={update.isPending || !enabled || draft === null}>
            {update.isPending && <span className="loading loading-spinner loading-xs" />}
            Save limit
          </button>
        </form>
        {updateError && (
          <div role="alert" className="alert alert-error alert-soft">
            <span>{updateError}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ScheduleSection() {
  const { data } = api.settings.getSettings.useQuery();
  const { data: schedule } = api.collector.getSchedule.useQuery();
  const utils = api.useUtils();
  const [draft, setDraft] = useState<number | null>(null);
  const update = api.settings.updateSettings.useMutation({
    onSuccess: async () => {
      // Wait for fresh values before dropping the draft, so the field does not flicker.
      await Promise.all([
        utils.settings.getSettings.invalidate(),
        utils.collector.getSchedule.invalidate(),
      ]);
      setDraft(null);
    },
  });
  const minutes = draft ?? data?.collectionIntervalMins ?? 30;
  const autoOn = data?.autoCollectEnabled !== false;
  const { data: sessionList } = api.session.list.useQuery();
  const thisSession = sessionList?.sessions.find((session) => session.id === sessionList.activeId);
  const setAutoCollect = api.session.setAutoCollect.useMutation({
    onSuccess: () =>
      Promise.all([utils.session.list.invalidate(), utils.collector.getSchedule.invalidate()]),
  });
  const updateError = readableError(update.error ?? setAutoCollect.error);

  return (
    <div className="card card-border bg-base-100">
      <div className="card-body">
        <h3 className="card-title text-base">Collection schedule</h3>
        <p className="text-sm text-base-content/70">
          A collection runs in the background on this interval. If one is already
          going, the next waits in a queue. Duplicate posts are skipped, every new
          post is saved with its tags, and only relevant posts get a one-line summary.
        </p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const next = Number.isFinite(minutes)
              ? Math.min(1440, Math.max(5, Math.round(minutes)))
              : 30;
            update.mutate({ collectionIntervalMins: next });
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            Minutes between runs
            <input
              type="number"
              min={5}
              max={1440}
              className="input w-32"
              value={minutes}
              onChange={(event) => setDraft(Number(event.target.value))}
            />
          </label>
          <button type="submit" className="btn" disabled={update.isPending}>
            {update.isPending && <span className="loading loading-spinner loading-xs" />}
            Save schedule
          </button>
        </form>
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="toggle"
            checked={autoOn}
            disabled={update.isPending}
            onChange={(event) => update.mutate({ autoCollectEnabled: event.target.checked })}
          />
          <span>
            Collect automatically
            <span className="block text-base-content/70">
              {autoOn
                ? "Runs start on their own. Turn this off to stop spending credits."
                : "Paused for every session. Nothing runs until you press Run collection on the dashboard."}
            </span>
          </span>
        </label>
        {thisSession && (
          <label className="flex cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="toggle"
              checked={thisSession.autoCollect}
              disabled={setAutoCollect.isPending || !autoOn}
              onChange={(event) => setAutoCollect.mutate({ id: thisSession.id, enabled: event.target.checked })}
            />
            <span>
              Include this session in the schedule
              <span className="block text-base-content/70">
                {thisSession.autoCollect
                  ? "It collects on the schedule even while another session is open, and shows a badge when new posts arrive."
                  : "It collects only when you press Run collection."}
              </span>
            </span>
          </label>
        )}
        {schedule && schedule.searchesPerRun > 0 && (
          <p className="text-sm text-base-content/70">
            Each run of this session makes {schedule.searchesPerRun} {schedule.searchesPerRun === 1 ? "search" : "searches"}, at most{" "}
            {schedule.creditsPerRun.toLocaleString()} credits. {autoOn ? "At this interval that is at most " : "If it ran at this interval it would be at most "}
            {schedule.creditsPerDay.toLocaleString()} credits a day. A search that finds nothing costs nothing. Author lookups cost extra.
          </p>
        )}
        {updateError && (
          <div role="alert" className="alert alert-error alert-soft">
            <span>{updateError}</span>
          </div>
        )}
      </div>
    </div>
  );
}
