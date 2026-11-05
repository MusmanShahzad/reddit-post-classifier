import { mentionsName } from "@/lib/filter-checks";
import { aliasList, matchingKeywords, type TagKeyword } from "@/lib/post-tags";
import type { db as dbType } from "@/server/db";

type PrismaClient = typeof dbType;

/**
 * Links a saved post to every keyword its search matches. Safe to call again.
 * Several names can share one search, so with the post's text a name is linked
 * only when the post actually mentions it.
 */
export async function linkPostKeywords(
  db: PrismaClient,
  postId: string,
  query: string | null | undefined,
  keywords: TagKeyword[],
  postText?: string,
): Promise<number> {
  const hits = matchingKeywords(query, keywords).filter((keyword) => {
    if (postText === undefined || (keyword.type !== "brand" && keyword.type !== "competitor")) return true;
    return [keyword.value, ...aliasList(keyword.aliases)].some((name) => mentionsName(postText, name));
  });
  for (const keyword of hits) {
    await db.postKeyword.upsert({
      where: { postId_keywordId: { postId, keywordId: keyword.id } },
      create: { postId, keywordId: keyword.id },
      update: {},
    });
  }
  return hits.length;
}
