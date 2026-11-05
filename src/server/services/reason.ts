/**
 * Writes the one-line summary shown on a post. GPT-4o-mini drafts it, free
 * checks catch known failures, and Jev confirms the line is backed by the post.
 * A line that fails twice is replaced with a plain label, so an invented claim
 * never reaches the team.
 *
 * @module services/reason
 */

import { fallbackReason, reasonProblems } from "@/lib/reason-checks";
import { postExcerpt } from "@/lib/relevance";
import { reasonIsBacked } from "./classifier";
import { generatePostReason } from "./openai";

const MAX_ATTEMPTS = 2;
const EXCERPT_LENGTH = 1500;

export async function writeReason(input: {
  post: { title: string; body: string; subreddit: string };
  companyName: string;
  category: string;
  keepWhen: string;
  /** Every brand and competitor name the session tracks. */
  names: string[];
}): Promise<string> {
  const { post, names } = input;
  const postText = `${post.title} ${post.body}`;
  const excerpt = postExcerpt(post.body, names, EXCERPT_LENGTH);
  let correction: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const draft = await generatePostReason({
      post: { ...post, body: excerpt },
      companyName: input.companyName,
      category: input.category,
      keepWhen: input.keepWhen,
      correction,
    });
    if (!draft) break;

    const problems = reasonProblems({ text: draft, postText, names });
    if (problems.length > 0) {
      correction = `Your last line was rejected because ${problems.join(" and ")}.`;
      continue;
    }
    if (await reasonIsBacked(`Title: ${post.title}\nBody: ${excerpt}`, draft)) return draft;
    correction = "Your last line was rejected because it claimed something the post does not say.";
  }

  return fallbackReason(input.category, post.title);
}
