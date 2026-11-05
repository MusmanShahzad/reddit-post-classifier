interface ErrorLike {
  message: string;
  data?: {
    zodError?: {
      formErrors: string[];
      fieldErrors: Record<string, string[] | undefined>;
    } | null;
  } | null;
}

/**
 * Whether a call failed because no answer came back, such as during a restart
 * or a dropped connection. An answer from the server, even an error, has data
 * or a response on it.
 */
export function isConnectionFailure(result: unknown): boolean {
  if (!(result instanceof Error)) return false;
  const { data, meta } = result as Error & { data?: unknown; meta?: { response?: unknown } };
  return !data && !meta?.response;
}

/**
 * One readable sentence for a failed tRPC call. Validation errors give the
 * first field message ("Use a subreddit name like webdev") instead of raw JSON.
 */
export function readableError(error: ErrorLike | null | undefined): string | null {
  if (!error) return null;

  const zod = error.data?.zodError;
  if (zod) {
    const field = Object.values(zod.fieldErrors).find((messages) => messages && messages.length > 0);
    const first = field?.[0] ?? zod.formErrors[0];
    if (first) return first;
  }

  return error.message || "Something went wrong. Try again.";
}
