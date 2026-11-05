import { describe, expect, it } from "vitest";
import { activityRuns, type ActivityEntry } from "@/lib/activity";

let clock = Date.parse("2026-11-05T12:00:00Z");
function line(type: string, message: string, extra: Partial<ActivityEntry> = {}): ActivityEntry {
  clock += 1000;
  return { id: String(clock), type, message, timestamp: new Date(clock), runId: "run-1", runStatus: "completed", ...extra };
}
const only = (entries: ActivityEntry[]) => activityRuns(entries)[0]!;
const titles = (entries: ActivityEntry[]) => only(entries).items.map((item) => item.title);

describe("activityRuns", () => {
  it("groups lines by run, newest run first", () => {
    const runs = activityRuns([
      line("started", "First run", { runId: "a" }),
      line("started", "Second run", { runId: "b" }),
    ]);
    expect(runs.map((run) => run.id)).toEqual(["b", "a"]);
  });

  it("reads a found line into its numbers and search", () => {
    const [item] = only([line("fetched", 'Found 7 posts for "Shopmonkey" (3 new, 1 duplicates, 3 without the name)')]).items;
    expect(item).toMatchObject({
      title: "Found 7 posts",
      query: '"Shopmonkey"',
      chips: ["3 new", "1 duplicate", "3 dropped"],
      tone: "info",
    });
  });

  it("reads the older line with doubled quotes, and a widened search", () => {
    const [older] = only([line("fetched", 'Found 1 posts for ""Acme"" (1 new, 0 duplicates)')]).items;
    expect(older).toMatchObject({ title: "Found 1 post", query: '""Acme""', chips: ["1 new"] });

    const [wide] = only([line("fetched", "Found 7 posts for pharmacy from the past year (7 new, 0 duplicates)")]).items;
    expect(wide).toMatchObject({ query: "pharmacy", chips: ["7 new", "from the past year"] });
  });

  it("says plainly when a search found nothing", () => {
    const [item] = only([line("fetched", 'Found 0 posts for "Acme" (0 new, 0 duplicates)')]).items;
    expect(item).toMatchObject({ title: "No posts found", tone: "neutral" });
  });

  it("merges every classified line in a run into one expandable item", () => {
    const items = only([
      line("classified", '✓ complaint — "Acme broke..."'),
      line("fetched", 'Found 1 posts for "Acme" (1 new, 0 duplicates)'),
      line("classified", '✗ other — "Noise post"'),
    ]).items;
    const posts = items.find((item) => item.kind === "posts")!;

    expect(items).toHaveLength(2);
    expect(posts).toMatchObject({ title: "Classified 2 posts", chips: ["1 kept", "1 filtered"] });
    expect(posts.posts).toEqual([
      { kept: false, label: "Other", title: "Noise post" },
      { kept: true, label: "Complaint", title: "Acme broke" },
    ]);
  });

  it("turns many rate limits into one line, not one per wait", () => {
    const entries: ActivityEntry[] = [];
    for (let i = 0; i < 15; i++) {
      entries.push(line("waiting", "ScrapeBadger rate limited the request (429). The searches wait 20 seconds."));
      entries.push(line("resumed", "The wait is over. Continuing the queue."));
    }
    const run = only(entries);

    expect(run.items).toHaveLength(1);
    expect(run.items[0]).toMatchObject({ title: "Rate limited 15 times. Searches carried on after each wait", tone: "warning", problem: true });
    expect(run.items[0]?.detail).toBeUndefined();
    expect(run.problems).toBe(1);
  });

  it("shows the reason while the searches are still paused", () => {
    const [item] = only([line("waiting", "ScrapeBadger is out of credits.", { runStatus: "running" })]).items;
    expect(item).toMatchObject({ title: "Rate limited. Searches are paused", detail: "ScrapeBadger is out of credits." });
  });

  it("counts posts delayed by a limit together", () => {
    const [item] = only([
      line("post_waiting", 'Rate limited on "One...". This post retries in 5 seconds. Other posts carry on.'),
      line("post_waiting", 'Rate limited on "Two...". This post retries in 5 seconds. Other posts carry on.'),
    ]).items;
    expect(item).toMatchObject({ title: "2 classifications delayed by a rate limit", problem: true });
  });

  it("shows a search only until its result arrives", () => {
    const search = line("fetching", 'Searching Reddit: "Acme" in 3 subreddits', { runStatus: "running" });
    expect(titles([search])).toEqual(["Searching Reddit in 3 subreddits"]);
    expect(only([search]).items[0]?.query).toBe('"Acme"');
    expect(titles([search, line("fetched", 'Found 0 posts for "Acme" (0 new, 0 duplicates)')])).toEqual(["No posts found"]);
  });

  it("hides progress and repeated summary lines, and keeps summary lines when they are all a run has", () => {
    expect(
      titles([
        line("summarizing", "Writing the one-line reason"),
        line("started", "Collection started for Acme. 1 search."),
        line("dedup", "1 new posts (0 duplicates skipped)"),
        line("classify", "Classified 1: 1 relevant, 0 filtered"),
      ]),
    ).toEqual(["Collection started for Acme. 1 search."]);
    expect(titles([line("fetch", "Fetched 240 posts")])).toEqual(["Fetched 240 posts"]);
  });

  it("summarises a finished run, for both wordings", () => {
    for (const word of ["kept", "relevant"]) {
      const run = only([line("completed", `Collection complete! 9 new posts, 4 ${word}.`)]);
      expect(run.chips).toEqual(["9 new", "4 kept"]);
      expect(run.items[0]).toMatchObject({ title: "Run finished", tone: "success" });
    }
  });

  it("marks errors as problems", () => {
    const run = only([line("error", "Error searching: down")]);
    expect(run.items[0]).toMatchObject({ kind: "problem", tone: "error", problem: true });
    expect(run.problems).toBe(1);
  });

  it("drops a run with nothing to show", () => {
    expect(activityRuns([line("summarizing", "Writing")])).toEqual([]);
  });
});
