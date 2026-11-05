import { mentionsName } from "@/lib/filter-checks";
import { aliasList, isSearchableAlias } from "@/lib/post-tags";

export interface PostMentions {
  /** Brands and competitors the session tracks that the post names. */
  names: { value: string; type: string }[];
  /** Reddit users the post refers to as u/name, not counting its author. */
  people: string[];
}

const USER_MENTION = /(?:^|[^\w/])\/?u\/([A-Za-z0-9_-]{3,20})\b/g;

/** Who and what a post mentions. Read from its text, so it costs no API calls. */
export function postMentions(
  post: { title: string; body: string; author: string },
  keywords: { value: string; type: string; aliases: string }[],
): PostMentions {
  const text = `${post.title} ${post.body}`;

  const names = keywords
    .filter((keyword) => keyword.type === "brand" || keyword.type === "competitor")
    .filter((keyword) =>
      [keyword.value, ...aliasList(keyword.aliases).filter(isSearchableAlias)].some((name) =>
        mentionsName(text, name),
      ),
    )
    .map(({ value, type }) => ({ value, type }));

  const people = new Map<string, string>();
  for (const match of text.matchAll(USER_MENTION)) {
    const name = match[1]!;
    if (name.toLowerCase() !== post.author.toLowerCase()) people.set(name.toLowerCase(), name);
  }

  return { names, people: [...people.values()] };
}
