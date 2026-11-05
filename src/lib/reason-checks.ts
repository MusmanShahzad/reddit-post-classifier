/**
 * Free checks on a one-line summary before anyone sees it. They catch the
 * failures seen on real posts: lines written as if by the author, a trailing
 * "Reply.", and a product the post never mentions.
 */

import { mentionsName } from "@/lib/filter-checks";

export const MAX_REASON_WORDS = 30;

export interface ReasonInput {
  /** The line to check. */
  text: string;
  /** The post's title and body. */
  postText: string;
  /** Every brand and competitor name the session tracks. */
  names: string[];
}

/** What is wrong with a summary. An empty list means it passes. */
export function reasonProblems({ text, postText, names }: ReasonInput): string[] {
  const problems: string[] = [];
  const line = text.trim();

  if (!line) return ["it is empty"];
  if (/\b(I|I'm|I’m|I've|I’ve|I'd|I’d)\b/.test(line) || /\b(my|me|mine|we|our|us)\b/i.test(line)) {
    problems.push('it is written in the first person; write about "the author"');
  }
  if (line.split(/\s+/).length > MAX_REASON_WORDS) {
    problems.push(`it is longer than ${MAX_REASON_WORDS} words`);
  }
  if (/\b(reply|respond|please|reach out|offer help)\b[.!]?$/i.test(line)) {
    problems.push("it ends with an instruction; only describe the post");
  }
  const invented = names.filter((name) => mentionsName(line, name) && !mentionsName(postText, name));
  if (invented.length > 0) {
    problems.push(`it names ${invented.join(", ")}, which the post does not mention`);
  }
  return problems;
}

/** A plain line that cannot state anything false, used when no draft passes. */
export function fallbackReason(category: string, title: string): string {
  const kind = category === "other" ? "Post" : `${category.replaceAll("_", " ")} post`;
  const label = kind.charAt(0).toUpperCase() + kind.slice(1);
  const words = title.trim().split(/\s+/);
  const shortTitle = words.length > 20 ? `${words.slice(0, 20).join(" ")}...` : title.trim();
  return `${label}: ${shortTitle}`;
}
