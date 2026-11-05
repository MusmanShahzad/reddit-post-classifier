/**
 * How many times to try one request after HTTP 429 or 503. ScrapeBadger's free
 * tier allows 5 requests and asks for 15 seconds between retries, so 5 tries
 * wait out a full minute.
 */
export const MAX_RATE_LIMIT_RETRIES = 5;

/** A request with no answer after this long fails, so a stuck provider cannot hang a run or the setup. */
export const REQUEST_TIMEOUT_MS = 20_000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The subreddits a search asks for, without any `r/` prefix or repeats. */
export function subredditNames(options: { subreddits?: string[]; subreddit?: string }): string[] {
  return [...new Set(
    [...(options.subreddits ?? []), ...(options.subreddit ? [options.subreddit] : [])]
      .map((name) => name.replace(/^r\//i, "").trim())
      .filter(Boolean),
  )];
}

/** The longest a request waits in place. A longer wait is the caller's to handle. */
const LONGEST_IN_PLACE_WAIT_MS = 60_000;

/**
 * - `rate_limit`: too many requests. Nothing is wrong with the search.
 * - `no_credits`: the account is empty. Nothing is wrong with the search.
 * - `outage`: the source failed or did not answer. The search itself may be the cause.
 */
export type ProviderWaitKind = "rate_limit" | "no_credits" | "outage";

/** The source cannot serve this request right now, and the same request can work later. */
export class ProviderWaitError extends Error {
  constructor(
    message: string,
    readonly kind: ProviderWaitKind,
    /** How long the source asked for, when it said. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "ProviderWaitError";
  }
}

/**
 * Reads `Retry-After`, which is either a number of seconds or a date. Without
 * it, `X-RateLimit-Reset` gives the time the window ends, in epoch seconds.
 */
export function retryAfterMs(response: Response, now: number = Date.now()): number | null {
  const header = response.headers.get("Retry-After")?.trim();
  if (!header) {
    const reset = Number(response.headers.get("X-RateLimit-Reset"));
    return Number.isFinite(reset) && reset * 1000 > now ? reset * 1000 - now : null;
  }

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds > 0 ? seconds * 1000 : null;

  const date = Date.parse(header);
  return Number.isNaN(date) || date <= now ? null : date - now;
}

/**
 * Fetches a URL. Any other status than 429 or 5xx is returned as-is so the
 * caller can decide whether it is an error.
 *
 * With `retryThrottles` on, HTTP 429 and 503 wait for `Retry-After` (or 2
 * seconds) and try again, up to {@link MAX_RATE_LIMIT_RETRIES} attempts. This
 * suits a person waiting on the answer. The search queue turns it off, so a
 * limit reaches it at once and it can show the wait.
 *
 * @throws {ProviderWaitError} When the source is still throttling, is failing, or did not answer.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string,
  retryThrottles = true,
): Promise<Response> {
  const attempts = retryThrottles ? MAX_RATE_LIMIT_RETRIES : 1;

  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...init });
    } catch (error) {
      throw new ProviderWaitError(
        `${label} did not answer: ${error instanceof Error ? error.message : "Unknown"}`,
        "outage",
      );
    }

    if (response.status !== 429 && response.status < 500) return response;

    const askedFor = retryAfterMs(response);
    const waitMs = askedFor ?? 2000;
    const canRetry =
      (response.status === 429 || response.status === 503) &&
      attempt < attempts &&
      waitMs <= LONGEST_IN_PLACE_WAIT_MS;

    if (!canRetry) {
      throw response.status === 429
        ? new ProviderWaitError(`${label} rate limited the request (429).`, "rate_limit", askedFor)
        : new ProviderWaitError(`${label} is unavailable right now (${response.status}).`, "outage", askedFor);
    }

    console.warn(
      `${label} rate limited (attempt ${attempt}/${attempts}). Waiting ${Math.round(waitMs / 1000)}s`,
    );
    await sleep(waitMs);
  }
}
