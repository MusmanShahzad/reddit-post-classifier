import { keywordMatchesQuery } from "@/lib/search-stats";

export interface TagKeyword {
  id: string;
  value: string;
  aliases: string;
  type?: string;
}

/** Reads stored aliases. A damaged value gives an empty list. */
export function aliasList(stored: string): string[] {
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((alias): alias is string => typeof alias === "string")
      : [];
  } catch {
    return [];
  }
}

/** Keywords whose name or alias appears in the search that found a post. */
export function matchingKeywords(query: string | null | undefined, keywords: TagKeyword[]): TagKeyword[] {
  if (!query?.trim()) return [];
  return keywords.filter((keyword) =>
    keywordMatchesQuery(query, keyword.value, aliasList(keyword.aliases)),
  );
}

/**
 * Every brand and competitor name a search asks for, with aliases. Empty means
 * the search is a topic search. A post found by a name search must contain one
 * of these names.
 */
export function namesInQuery(
  query: string,
  keywords: Array<TagKeyword & { type: string }>,
): string[] {
  const named = keywords.filter((keyword) => keyword.type === "brand" || keyword.type === "competitor");
  return matchingKeywords(query, named).flatMap((keyword) => [
    keyword.value,
    ...aliasList(keyword.aliases).filter(isSearchableAlias),
  ]);
}

/**
 * A two-letter alias such as "QB" also means other things, so it is not searched
 * and never proves a match. Jev still reads it when judging a post. A three-letter
 * name such as "QBO" is usually deliberate, and Jev filters out any off-topic posts.
 */
export function isSearchableAlias(alias: string): boolean {
  return alias.trim().length >= 3;
}

/**
 * The label saved with each classification. A post found by "Shopmonkey" is
 * logged as Shopmonkey, not as the company name.
 */
export function trackedKeyword(
  query: string | null | undefined,
  keywords: TagKeyword[],
  fallback: string,
): string {
  const hits = matchingKeywords(query, keywords);
  if (hits.length > 0) return hits.map((keyword) => keyword.value).join(", ");
  const plain = query?.replace(/^"|"$/g, "").trim();
  return plain || fallback;
}
