import { describe, expect, it } from "vitest";
import { clampInterval, nextDueAt } from "@/lib/schedule";
import { isSameSiteRequest } from "@/lib/request-guard";
import { TRPCClientError } from "@trpc/client";
import { isConnectionFailure, readableError } from "@/lib/trpc-error";

function headers(values: Record<string, string>) {
  return new Headers(values);
}

describe("isSameSiteRequest", () => {
  it("allows a request from this app", () => {
    expect(
      isSameSiteRequest(
        headers({ "sec-fetch-site": "same-origin", origin: "http://localhost:3000", host: "localhost:3000" }),
      ),
    ).toBe(true);
  });

  it("blocks a page on another site", () => {
    expect(isSameSiteRequest(headers({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(
      isSameSiteRequest(headers({ origin: "https://evil.example", host: "localhost:3000" })),
    ).toBe(false);
  });

  it("allows scripts that send no browser headers", () => {
    expect(isSameSiteRequest(headers({}))).toBe(true);
  });

  it("blocks a malformed origin", () => {
    expect(isSameSiteRequest(headers({ origin: "not a url", host: "localhost:3000" }))).toBe(false);
  });
});

describe("clampInterval", () => {
  it("keeps a sane value", () => {
    expect(clampInterval(45)).toBe(45);
  });

  it("falls back for missing or too small values", () => {
    expect(clampInterval(undefined)).toBe(30);
    expect(clampInterval(null)).toBe(30);
    expect(clampInterval(1)).toBe(30);
    expect(clampInterval(Number.NaN)).toBe(30);
  });

  it("caps at one day", () => {
    expect(clampInterval(99999)).toBe(1440);
  });
});

describe("nextDueAt", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const minutes = (n: number) => n * 60_000;

  it("is due now when nothing has run", () => {
    expect(nextDueAt(null, 30, now)).toEqual(now);
  });

  it("counts the gap from when the last run finished", () => {
    const last = {
      status: "completed",
      startedAt: new Date(now.getTime() - minutes(100)),
      completedAt: new Date(now.getTime() - minutes(10)),
    };
    expect(nextDueAt(last, 30, now).getTime()).toBe(now.getTime() + minutes(20));
  });

  it("does not start a second run right after a slow one", () => {
    const last = {
      status: "completed",
      startedAt: new Date(now.getTime() - minutes(60)),
      completedAt: new Date(now.getTime() - minutes(1)),
    };
    expect(nextDueAt(last, 30, now).getTime()).toBeGreaterThan(now.getTime());
  });

  it("waits a full interval while a run is still going", () => {
    const last = { status: "running", startedAt: new Date(now.getTime() - minutes(90)), completedAt: null };
    expect(nextDueAt(last, 30, now).getTime()).toBe(now.getTime() + minutes(30));
  });
});

describe("isConnectionFailure", () => {
  it("recognises a call that got no answer", () => {
    expect(isConnectionFailure(TRPCClientError.from(new TypeError("Failed to fetch")))).toBe(true);
  });

  it("does not hide an error the server sent", () => {
    const fromServer = TRPCClientError.from({
      error: { message: "Database is locked", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } },
    });
    expect(isConnectionFailure(fromServer)).toBe(false);
  });

  it("does not hide a broken response, such as a 500 page", () => {
    const broken = TRPCClientError.from(new Error("Unexpected token <"), { meta: { response: new Response("", { status: 500 }) } });
    expect(isConnectionFailure(broken)).toBe(false);
  });

  it("ignores anything that is not an error", () => {
    expect(isConnectionFailure({ result: { data: [] } })).toBe(false);
    expect(isConnectionFailure(undefined)).toBe(false);
  });
});

describe("readableError", () => {
  it("returns null with no error", () => {
    expect(readableError(null)).toBeNull();
  });

  it("prefers the first validation message", () => {
    expect(
      readableError({
        message: "[{...raw json}]",
        data: { zodError: { formErrors: [], fieldErrors: { name: ["Use a subreddit name like webdev"] } } },
      }),
    ).toBe("Use a subreddit name like webdev");
  });

  it("falls back to the plain message", () => {
    expect(readableError({ message: "Post not found.", data: { zodError: null } })).toBe("Post not found.");
  });
});
