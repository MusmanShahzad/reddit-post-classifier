import { CATEGORY_LABELS } from "@/lib/types";

/** One saved log line, as the server sends it. */
export interface ActivityEntry {
  id?: string;
  type: string;
  message: string;
  timestamp?: Date | string;
  runId?: string;
  runStatus?: string;
}

export type ActivityKind = "start" | "search" | "found" | "posts" | "wait" | "done" | "problem" | "note";
export type ActivityTone = "neutral" | "info" | "success" | "warning" | "error";

export interface ActivityPostLine {
  kept: boolean;
  label: string;
  title: string;
}

/** One line a person reads. Several log lines can become one item. */
export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  tone: ActivityTone;
  title: string;
  /** The search this is about, shown as code. */
  query?: string;
  detail?: string;
  chips?: string[];
  /** Hidden until opened, such as each post in a batch. */
  posts?: ActivityPostLine[];
  timestamp: Date;
  /** Needs attention, so it shows under the Problems filter. */
  problem: boolean;
}

export interface ActivityRun {
  id: string;
  status?: string;
  startedAt: Date;
  items: ActivityItem[];
  chips: string[];
  problems: number;
}

/** Written during a run, and only useful when a run has no better lines to show. */
const SUMMARY_TYPES = new Set(["fetch", "classify", "summarize", "dedup"]);
/** Progress lines that a finished line replaces. */
const NOISE_TYPES = new Set(["classifying", "summarizing"]);

const count = (value: number, word: string) => `${value} ${word}${value === 1 ? "" : "s"}`;

const FOUND = /^Found (\d+) posts for (.+?)(?: from the past (\w+))? \((\d+) new, (\d+) duplicates(?:, (\d+) without the name)?\)$/;
const SEARCHING = /^Searching Reddit: (.+?)(?: in (\d+) subreddits)?$/;
const CLASSIFIED = /^([✓✗]) (\S+) — "(.*?)(?:\.\.\.)?"$/;
const FINISHED = /^Collection complete! (\d+) new posts, (\d+) (?:relevant|kept)\.?$/;
const DELAYED = /^Rate limited on "(.*?)(?:\.\.\.)?"\./;

function foundItem(base: Pick<ActivityItem, "id" | "timestamp">, match: RegExpExecArray): ActivityItem {
  const total = Number(match[1]);
  const [fresh, duplicates, dropped] = [match[4], match[5], match[6]].map((value) => Number(value ?? 0));
  const chips = [
    ...(fresh ? [`${fresh} new`] : []),
    ...(duplicates ? [count(duplicates!, "duplicate")] : []),
    ...(dropped ? [`${dropped} dropped`] : []),
    ...(match[3] ? [`from the past ${match[3]}`] : []),
  ];
  return {
    ...base,
    kind: "found",
    tone: total > 0 ? "info" : "neutral",
    title: total > 0 ? `Found ${count(total, "post")}` : "No posts found",
    query: match[2],
    chips,
    problem: false,
  };
}

function toRun(id: string, entries: ActivityEntry[]): ActivityRun {
  // Oldest first, so merged items land where their latest line happened.
  const ordered = [...entries].sort((a, b) => time(a) - time(b));
  const hasRealLines = ordered.some((entry) => !SUMMARY_TYPES.has(entry.type) && !NOISE_TYPES.has(entry.type));
  const finished = ordered.find((entry) => FINISHED.test(entry.message));

  const items: ActivityItem[] = [];
  const posts: ActivityPostLine[] = [];
  const delayed: string[] = [];
  let waits = 0;
  let lastWait = null as ActivityEntry | null;
  let waitingNow = false;
  let lastClassified = null as ActivityEntry | null;
  let lastDelayed = null as ActivityEntry | null;

  ordered.forEach((entry, index) => {
    const base = { id: entry.id ?? `${id}-${index}`, timestamp: new Date(time(entry)) };

    if (NOISE_TYPES.has(entry.type) || (SUMMARY_TYPES.has(entry.type) && hasRealLines)) return;

    if (entry.type === "classified") {
      const match = CLASSIFIED.exec(entry.message);
      posts.push({
        kept: match?.[1] !== "✗",
        label: match ? (CATEGORY_LABELS[match[2] as keyof typeof CATEGORY_LABELS] ?? match[2]!) : "",
        title: match?.[3] ?? entry.message,
      });
      lastClassified = entry;
      return;
    }
    if (entry.type === "waiting") {
      waits += 1;
      lastWait = entry;
      waitingNow = true;
      return;
    }
    if (entry.type === "resumed") {
      waitingNow = false;
      return;
    }
    if (entry.type === "post_waiting") {
      delayed.push(DELAYED.exec(entry.message)?.[1] ?? entry.message);
      lastDelayed = entry;
      return;
    }
    if (entry.type === "fetching") {
      // Only the search in progress is worth a line. The result replaces it.
      const stillSearching = index === ordered.length - 1 || !ordered.slice(index + 1).some((later) => later.type === "fetched");
      if (!stillSearching) return;
      const match = SEARCHING.exec(entry.message);
      items.push({
        ...base,
        kind: "search",
        tone: "info",
        title: match?.[2] ? `Searching Reddit in ${count(Number(match[2]), "subreddit")}` : "Searching Reddit",
        query: match?.[1],
        problem: false,
      });
      return;
    }
    if (entry.type === "fetched") {
      const match = FOUND.exec(entry.message);
      items.push(
        match
          ? foundItem(base, match)
          : { ...base, kind: "found", tone: "info", title: entry.message, problem: false },
      );
      return;
    }
    if (entry.type === "completed") {
      const match = FINISHED.exec(entry.message);
      items.push({
        ...base,
        kind: "done",
        tone: "success",
        title: "Run finished",
        // A recognised line's numbers are already in the run's heading.
        detail: match ? undefined : entry.message,
        problem: false,
      });
      return;
    }
    if (entry.type === "error") {
      items.push({ ...base, kind: "problem", tone: "error", title: entry.message, problem: true });
      return;
    }
    if (entry.type === "started") {
      items.push({ ...base, kind: "start", tone: "neutral", title: entry.message, problem: false });
      return;
    }
    items.push({ ...base, kind: "note", tone: "neutral", title: entry.message, problem: false });
  });

  if (posts.length > 0 && lastClassified) {
    const kept = posts.filter((post) => post.kept).length;
    items.push({
      id: `${id}-classified`,
      kind: "posts",
      tone: kept > 0 ? "success" : "neutral",
      title: `Classified ${count(posts.length, "post")}`,
      chips: [`${kept} kept`, `${posts.length - kept} filtered`],
      posts: [...posts].reverse(),
      timestamp: new Date(time(lastClassified)),
      problem: false,
    });
  }
  if (lastWait) {
    // Repeated limits are one story, not a line for every wait.
    items.push({
      id: `${id}-waits`,
      kind: "wait",
      tone: "warning",
      title: waitingNow
        ? "Rate limited. Searches are paused"
        : waits === 1
          ? "Rate limited once. Searches carried on after a wait"
          : `Rate limited ${waits} times. Searches carried on after each wait`,
      detail: waitingNow ? lastWait.message : undefined,
      timestamp: new Date(time(lastWait)),
      problem: true,
    });
  }
  if (lastDelayed) {
    items.push({
      id: `${id}-delayed`,
      kind: "wait",
      tone: "warning",
      title: `${count(delayed.length, "classification")} delayed by a rate limit`,
      detail: "Each retries on its own, and other posts carried on.",
      timestamp: new Date(time(lastDelayed)),
      problem: true,
    });
  }

  const newest = items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  const finishedMatch = finished ? FINISHED.exec(finished.message) : null;

  return {
    id,
    status: ordered.at(-1)?.runStatus,
    startedAt: new Date(time(ordered[0]!)),
    items: newest,
    chips: finishedMatch ? [`${finishedMatch[1]} new`, `${finishedMatch[2]} kept`] : [],
    problems: newest.filter((item) => item.problem).length,
  };
}

function time(entry: ActivityEntry): number {
  return new Date(entry.timestamp ?? Date.now()).getTime();
}

/** Turns raw log lines into runs, newest first, with a readable line for each thing that happened. */
export function activityRuns(entries: ActivityEntry[]): ActivityRun[] {
  const byRun = new Map<string, ActivityEntry[]>();
  for (const entry of entries) {
    const id = entry.runId ?? "current";
    byRun.set(id, [...(byRun.get(id) ?? []), entry]);
  }
  return [...byRun.entries()]
    .map(([id, rows]) => toRun(id, rows))
    .filter((run) => run.items.length > 0)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
}
