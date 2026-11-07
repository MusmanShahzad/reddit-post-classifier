import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { needsBuild } from "../scripts/build-check.mjs";
import { databaseUrl, DEFAULT_DATABASE_URL } from "../src/lib/database-url.js";

describe("databaseUrl", () => {
  it("uses the default when the value is missing or blank", () => {
    expect(databaseUrl("")).toBe(DEFAULT_DATABASE_URL);
    expect(databaseUrl("   ")).toBe(DEFAULT_DATABASE_URL);
    expect(DEFAULT_DATABASE_URL).toBe("file:./dev.db");
  });

  it("keeps a value that was provided", () => {
    expect(databaseUrl("file:/data/radarr.db")).toBe("file:/data/radarr.db");
  });
});

describe("needsBuild", () => {
  const BUILT_AT = new Date("2026-01-02T00:00:00Z");
  let root: string;

  function writeAt(path: string, time: Date) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "x");
    utimesSync(file, time, time);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "radarr-build-"));
    writeAt("src/app/page.tsx", new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("builds when there is no build", () => {
    expect(needsBuild(root)).toBe(true);
  });

  it("does not build again when the code is unchanged", () => {
    writeAt(".next/BUILD_ID", BUILT_AT);
    expect(needsBuild(root)).toBe(false);
  });

  it("builds again when a nested source file changed after the build", () => {
    writeAt(".next/BUILD_ID", BUILT_AT);
    writeAt("src/server/deep/service.ts", new Date("2026-01-03T00:00:00Z"));
    expect(needsBuild(root)).toBe(true);
  });

  it("builds again when the dependencies changed after the build", () => {
    writeAt(".next/BUILD_ID", BUILT_AT);
    writeAt("package-lock.json", new Date("2026-01-03T00:00:00Z"));
    expect(needsBuild(root)).toBe(true);
  });
});
