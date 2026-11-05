/**
 * Author profiles for the feed: picture, name, karma and account age.
 *
 * A profile lookup is a paid request, so it is made once per username and only
 * for authors of relevant posts, and Settings can turn lookups off or lower the
 * number per run. Searches come first, so lookups start after the search queue
 * finishes and stop at the first limit. A failed lookup never
 * affects a run. Its post shows the username, and the next run tries again.
 *
 * @module services/authors
 */

import type { db as dbType } from "@/server/db";
import { getRedditUser } from "./reddit";
import { ProviderWaitError, sleep } from "./reddit/http";

type PrismaClient = typeof dbType;

const DEFAULT_LOOKUPS_PER_RUN = 25;
/** A longer limit ends lookups for this run instead of holding the run open. */
const LONGEST_LOOKUP_WAIT_MS = 30_000;
const MAX_LOOKUP_WAITS_PER_RUN = 10;

/** Tunable values. Tests set the waits to 0. */
export const authorConfig = {
  /** Time between paid lookups, to stay under rate limits. */
  delayBetweenLookupsMs: 1500,
  /** How often to check for new relevant posts while classification runs. */
  pollMs: 1000,
};

/** Paid lookups the settings allow in one run. The rest happen on later runs. */
async function lookupsAllowed(db: PrismaClient): Promise<number> {
  const settings = await db.appSettings.findUnique({
    where: { id: "default" },
    select: { authorLookupsEnabled: true, authorLookupsPerRun: true },
  });
  if (!settings) return DEFAULT_LOOKUPS_PER_RUN;
  return settings.authorLookupsEnabled ? settings.authorLookupsPerRun : 0;
}

/** The name a stored profile holds. Profiles saved before names were stored have it in their payload. */
function storedDisplayName(rawJson: string): string | null {
  try {
    const raw = JSON.parse(rawJson) as { subreddit?: { title?: unknown } | null };
    const title = raw.subreddit?.title;
    return typeof title === "string" && title.trim() ? title.trim() : null;
  } catch {
    return null;
  }
}

/** Attaches a profile to every saved post by this user that does not have one. */
async function linkAuthorPosts(db: PrismaClient, username: string, authorId: string) {
  await db.redditPost.updateMany({
    where: { author: username, authorProfileId: null },
    data: { authorProfileId: authorId },
  });
}

/**
 * Saves one profile and links it to the user's posts.
 *
 * @returns `"paid"` when a lookup was sent, or `"stored"` when no request was needed.
 */
export async function ensureAuthor(db: PrismaClient, username: string): Promise<"paid" | "stored"> {
  const known = await db.redditAuthor.findUnique({ where: { username } });
  if (known?.fetchedAt) {
    if (!known.displayName && known.rawJson) {
      const displayName = storedDisplayName(known.rawJson);
      if (displayName) await db.redditAuthor.update({ where: { id: known.id }, data: { displayName } });
    }
    await linkAuthorPosts(db, username, known.id);
    return "stored";
  }

  const profile = await getRedditUser(username);
  const data = {
    fetchedAt: new Date(),
    ...(profile
      ? {
          fullname: profile.fullname,
          displayName: profile.displayName,
          linkKarma: profile.linkKarma,
          commentKarma: profile.commentKarma,
          awardeeKarma: profile.awardeeKarma,
          awarderKarma: profile.awarderKarma,
          totalKarma: profile.totalKarma,
          createdUtc: profile.createdUtc ? new Date(profile.createdUtc * 1000) : null,
          isGold: profile.isGold,
          isEmployee: profile.isEmployee,
          isMod: profile.isMod,
          verified: profile.verified,
          hasVerifiedEmail: profile.hasVerifiedEmail,
          iconUrl: profile.iconUrl,
          rawJson: JSON.stringify(profile.raw),
        }
      : {}),
  };
  const author = await db.redditAuthor.upsert({
    where: { username },
    create: { username, ...data },
    update: data,
  });
  await linkAuthorPosts(db, username, author.id);
  return "paid";
}

/**
 * Fills in profiles for this session's relevant posts until classification ends.
 * Covers posts from earlier runs too.
 *
 * @returns How many paid lookups were sent.
 */
export async function lookUpAuthors(
  db: PrismaClient,
  companyId: string,
  isClassifying: () => boolean,
): Promise<number> {
  const tried = new Set(["[deleted]"]);
  let paid = 0;
  let limitWaits = 0;

  for (;;) {
    // Read first, so a post that became relevant just before the end is still seen.
    const stillClassifying = isClassifying();
    const next = await db.redditPost.findFirst({
      where: { companyId, isRelevant: true, authorProfileId: null, author: { notIn: [...tried] } },
      orderBy: { createdAt: "desc" },
      select: { author: true },
    });
    if (!next) {
      if (!stillClassifying) return paid;
      await sleep(authorConfig.pollMs);
      continue;
    }
    tried.add(next.author);

    const known = await db.redditAuthor.findUnique({
      where: { username: next.author },
      select: { fetchedAt: true },
    });
    // Read each time, so turning lookups off takes effect during a run.
    if (!known?.fetchedAt && paid >= (await lookupsAllowed(db))) continue;

    try {
      if ((await ensureAuthor(db, next.author)) === "paid") {
        paid++;
        await sleep(authorConfig.delayBetweenLookupsMs);
      }
    } catch (error) {
      if (error instanceof ProviderWaitError) {
        // The source allows only a few requests at a time, so a short wait is normal.
        const wait = error.kind === "rate_limit" ? error.retryAfterMs : null;
        if (wait !== null && wait <= LONGEST_LOOKUP_WAIT_MS && limitWaits < MAX_LOOKUP_WAITS_PER_RUN) {
          limitWaits++;
          tried.delete(next.author);
          await sleep(wait);
          continue;
        }
        console.warn(`[authors] stopped for this run: ${error.message}`);
        return paid;
      }
      console.warn(`[authors] lookup failed: ${error instanceof Error ? error.message : "Unknown"}`);
    }
  }
}
