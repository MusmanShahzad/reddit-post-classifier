/**
 * Blocks cross-site requests to routes that spend credits.
 *
 * A page on another site can make a browser send a POST to this app. Browsers
 * mark such a request with `Sec-Fetch-Site: cross-site` and an `Origin` that
 * is not this host. Requests without those headers (curl, scripts) pass,
 * because they cannot be driven by a visited web page.
 */
export function isSameSiteRequest(headers: Pick<Headers, "get">): boolean {
  const site = headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;

  const origin = headers.get("origin");
  if (origin) {
    const host = headers.get("host");
    try {
      return Boolean(host) && new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  return true;
}
