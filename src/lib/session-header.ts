/** Tells the server which session this browser tab is showing. */
export const SESSION_HEADER = "x-session-id";

/** The session in a URL like `/abc123`. The home page and other paths have none. */
export function sessionIdFromPath(pathname: string): string | null {
  return /^\/([\w-]+)\/?$/.exec(pathname)?.[1] ?? null;
}

/** The header for this tab's requests. Empty outside a session page. */
export function sessionHeaders(pathname: string): Record<string, string> {
  const id = sessionIdFromPath(pathname);
  return id ? { [SESSION_HEADER]: id } : {};
}
