import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { judgeDecision, sessionEvidence } from "@/lib/filter-checks";
import type { Goal } from "@/lib/goals";
import { classifyPost } from "@/server/services/classifier";

/**
 * Measures the filter against posts labelled by hand. It calls Jev for each post,
 * so it needs a real key, and it spends nothing on ScrapeBadger or OpenAI.
 *
 * The labelled file is not in the repo, because it holds the text of people's
 * posts. See "How we checked" in DECISIONS.md for its shape and the results.
 * Run with `npm run eval`.
 */
const FILE = process.env.EVAL_FILE ?? "evaluation/labelled-posts.json";
const THRESHOLD = 0.7;

interface Labelled {
  id: string;
  session: string;
  subreddit: string;
  title: string;
  body: string;
  postedAt: string;
  numComments: number;
  redditScore: number;
  /** Whether this session's team would want this post. */
  keep: boolean;
  category: string | null;
}

interface Session {
  name: string;
  goals: Goal[];
  product: string;
  keepWhen: string;
  keywords: { type: string; value: string; aliases: string[]; ambiguous?: boolean }[];
}

interface Row {
  id: string;
  session: string;
  keep: boolean;
  verdict: string;
  score: number;
  expectedCategory: string | null;
  category: string;
  title: string;
}

const ratio = (part: number, whole: number) => (whole > 0 ? `${((part / whole) * 100).toFixed(0)}% (${part}/${whole})` : "n/a");

it("reports precision and recall", async () => {
  if (!existsSync(FILE)) {
    console.log(`No labelled file at ${FILE}, so there is nothing to measure.`);
    return;
  }
  const { sessions, posts } = JSON.parse(readFileSync(FILE, "utf8")) as { sessions: Record<string, Session>; posts: Labelled[] };
  const rows: Row[] = [];

  for (const post of posts) {
    const session = sessions[post.session]!;
    const keywords = session.keywords.map((keyword, index) => ({ ...keyword, id: String(index), aliases: JSON.stringify(keyword.aliases) }));
    const result = await classifyPost({
      title: post.title,
      body: post.body,
      subreddit: post.subreddit,
      companyName: session.name,
      numComments: post.numComments,
      redditScore: post.redditScore,
      postedAt: new Date(post.postedAt),
      goals: session.goals,
      keywords,
      brief: { product: session.product, buyer: "", keepWhen: session.keepWhen, notAbout: "" },
    });
    const { verdict } = judgeDecision({
      score: result.relevanceScore,
      threshold: THRESHOLD,
      evidence: sessionEvidence(post, { name: session.name, product: session.product, keywords }),
      keepWhen: session.keepWhen,
      sentiment: result.sentiment,
      sentimentConfidence: result.sentimentConfidence,
      requestScore: result.relevanceScores?.matches_request,
    });
    rows.push({
      id: post.id,
      session: post.session,
      keep: post.keep,
      verdict,
      score: Number(result.relevanceScore.toFixed(2)),
      expectedCategory: post.category,
      category: result.category,
      title: post.title.slice(0, 80),
    });
  }

  const report = (label: string, group: Row[]) => {
    const wanted = group.filter((row) => row.keep);
    const kept = group.filter((row) => row.verdict !== "skip");
    const shown = group.filter((row) => row.verdict === "show");
    const hit = (list: Row[]) => list.filter((row) => row.keep).length;
    console.log(
      `${label.padEnd(11)} posts ${String(group.length).padStart(2)}, wanted ${String(wanted.length).padStart(2)} | ` +
        `kept: precision ${ratio(hit(kept), kept.length)}, recall ${ratio(hit(kept), wanted.length)} | ` +
        `feed only: precision ${ratio(hit(shown), shown.length)}, recall ${ratio(hit(shown), wanted.length)}`,
    );
  };

  report("ALL", rows);
  for (const name of Object.keys(sessions)) report(name, rows.filter((row) => row.session === name));

  const judged = rows.filter((row) => row.keep && row.verdict !== "skip");
  console.log(`CATEGORY ${ratio(judged.filter((row) => row.category === row.expectedCategory).length, judged.length)}`);
  console.log("DECISIONS", JSON.stringify(rows.reduce<Record<string, number>>((all, row) => ({ ...all, [row.verdict]: (all[row.verdict] ?? 0) + 1 }), {})));
  for (const row of rows) {
    const missed = row.keep && row.verdict === "skip";
    const wrongKeep = !row.keep && row.verdict !== "skip";
    const wrongCategory = row.keep && row.verdict !== "skip" && row.category !== row.expectedCategory;
    if (missed || wrongKeep || wrongCategory) {
      const kind = missed ? "MISSED" : wrongKeep ? `WRONG-${row.verdict.toUpperCase()}` : `CATEGORY ${row.expectedCategory}->${row.category}`;
      console.log(`${kind} ${row.session} ${row.score} ${row.title}`);
    }
  }
  writeFileSync(`${FILE}.results.json`, JSON.stringify(rows, null, 1));
});
