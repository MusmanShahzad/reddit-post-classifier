interface ErrorShape {
  status?: unknown;
  message?: unknown;
  retryAfterMs?: unknown;
  headers?: { get?: (name: string) => string | null } | null;
}

/**
 * Reads a rate limit from a Jev or OpenAI error. Both SDKs put the HTTP status
 * on the error. Returns `null` for any other kind of failure.
 */
export function rateLimitWait(error: unknown): { retryAfterMs: number | null } | null {
  if (typeof error !== "object" || error === null) return null;
  const { status, message, retryAfterMs, headers } = error as ErrorShape;

  const limited =
    status === 429 ||
    status === 503 ||
    (status === undefined && typeof message === "string" && /rate.?limit|too many requests/i.test(message));
  if (!limited) return null;

  if (typeof retryAfterMs === "number" && retryAfterMs > 0) return { retryAfterMs };
  const seconds = Number(headers?.get?.("retry-after"));
  return { retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null };
}
