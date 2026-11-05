import { execSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@generated/prisma";
import { expect } from "@playwright/test";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "vitest";
import { freshState, startFakeServices, type FakePost } from "./fake-services";

/**
 * Runs the production build in a real browser, with the real scheduler and a
 * throwaway database. ScrapeBadger, Jev and OpenAI are local stand-ins, so this
 * spends nothing. Run with `npm run test:e2e`. Screenshots go to `e2e-artifacts/`.
 */
const APP_PORT = 3211;
const FAKE_PORT = 3212;
const APP = `http://localhost:${APP_PORT}`;
const FAKE = `http://localhost:${FAKE_PORT}`;
const ARTIFACTS = path.resolve("e2e-artifacts");
/** One scheduler check is 30 seconds, plus time for the run to appear. */
const SCHEDULER_WAIT_MS = 45_000;
const QUERIES = ['"Acme"', '"Acme review"', '"Acme alternative"'];

const dir = mkdtempSync(path.join(tmpdir(), "radarr-e2e-"));
const databaseUrl = `file:${path.join(dir, "e2e.db").replace(/\\/g, "/")}`;
const appEnv = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: databaseUrl,
  REDDIT_PROVIDER: "scrapebadger",
  SCRAPEBADGER_API_KEY: "e2e",
  SCRAPEBADGER_BASE_URL: `${FAKE}/reddit`,
  TYPESAFE_API_KEY: "e2e",
  TYPESAFE_BASE_URL: `${FAKE}/jev`,
  OPENAI_API_KEY: "e2e",
  OPENAI_BASE_URL: `${FAKE}/openai`,
} as NodeJS.ProcessEnv;

const fake = { current: freshState() };
const db = new PrismaClient({ datasourceUrl: databaseUrl });
let fakeServer: Server;
let app: ChildProcess | null = null;
let browser: Browser;
let page: Page;
let problems: string[] = [];
let companyId: string;
let idCounter = 0;

function post(title: string, extra: Partial<FakePost> = {}): FakePost {
  idCounter += 1;
  return { id: `p${idCounter}`, title, ...extra };
}

async function startApp() {
  // A server left over from a stopped run would answer the health check and fail every test.
  if (await fetch(`${APP}/api/health`).then(() => true).catch(() => false)) {
    throw new Error(`Port ${APP_PORT} is already in use. Stop that server and run this again.`);
  }
  app = spawn("npx", ["next", "start", "-p", String(APP_PORT)], { env: appEnv, shell: true, stdio: "ignore" });
  await expect
    .poll(async () => fetch(`${APP}/api/health`).then((response) => response.status).catch(() => 0), {
      timeout: 60_000,
      intervals: [300],
    })
    .toBe(200);
}

function stopApp() {
  if (!app?.pid) return;
  // The shell starts next as a child, so the whole tree has to go, like a crash would.
  if (process.platform === "win32") execSync(`taskkill /pid ${app.pid} /t /f`, { stdio: "ignore" });
  else process.kill(-app.pid, "SIGKILL");
  app = null;
}

async function seedSession(label: string, data: Record<string, unknown> = {}) {
  const company = await db.company.create({
    data: {
      name: label,
      product: "project tracking software",
      keepWhen: "complaints and reviews",
      goals: '["own_feedback"]',
      autoCollect: false,
      keywords: { create: { type: "brand", value: "Acme" } },
      searchQueries: { create: QUERIES.map((query) => ({ query })) },
      ...data,
    },
  });
  return company.id;
}

async function settings(data: Record<string, unknown>) {
  await db.appSettings.update({ where: { id: "default" }, data });
}

const nav = (name: string) => page.getByRole("button", { name, exact: true }).first();
const sessionRow = (label: string) => page.locator('[role="button"]', { hasText: label }).first();
const live = () => page.getByTestId("live-status");
const cards = () => page.locator("article");

async function open(where: "Dashboard" | "Feed" | "Settings" = "Dashboard") {
  await page.goto(`${APP}/${companyId}`);
  await nav(where).click();
}

/** Starts a run the way the button does, without leaving the current screen. */
async function runNow() {
  await page.evaluate(() => fetch("/api/collect", { method: "POST" }).then((response) => response.status));
}

async function runFinished() {
  await expect
    .poll(() => db.collectionRun.count({ where: { status: { in: ["running", "queued"] } } }), {
      timeout: 90_000,
      intervals: [200],
    })
    .toBe(0);
}

const latestRun = () =>
  db.collectionRun.findFirstOrThrow({ orderBy: { startedAt: "desc" }, include: { searches: true, logs: true } });

async function shot(name: string) {
  await page.screenshot({ path: path.join(ARTIFACTS, `${name}.png`), fullPage: true });
}

beforeAll(async () => {
  mkdirSync(ARTIFACTS, { recursive: true });
  fakeServer = await startFakeServices(fake, FAKE_PORT);
  execSync("npx prisma db push --skip-generate --accept-data-loss", { env: appEnv, stdio: "pipe" });
  // Set E2E_SKIP_BUILD=1 to rerun against the last build.
  if (!process.env.E2E_SKIP_BUILD) {
    execSync("npx next build", { env: { ...appEnv, SKIP_ENV_VALIDATION: "1" }, stdio: "pipe" });
  }
  await db.appSettings.create({
    data: { id: "default", isOnboardingComplete: true, autoCollectEnabled: false },
  });
  await startApp();
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  stopApp();
  await db.$disconnect();
  fakeServer?.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows may hold the file for a moment. The temp folder is cleaned later.
  }
});

beforeEach(async () => {
  fake.current = freshState();
  problems = [];
  await db.company.deleteMany();
  await db.redditAuthor.deleteMany();
  companyId = await seedSession("Acme");
  await db.appSettings.update({
    where: { id: "default" },
    data: {
      activeCompanyId: companyId,
      autoCollectEnabled: false,
      authorLookupsEnabled: true,
      authorLookupsPerRun: 25,
      collectionIntervalMins: 30,
    },
  });

  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    // The browser itself logs a refused or failed request, and these tests cause those on purpose.
    // Anything the app logs is a problem, including during a dropped connection.
    if (message.type() === "error" && !/Failed to load resource/.test(message.text())) {
      problems.push(`console: ${message.text()}`);
    }
  });
});

afterEach(async () => {
  await page.close();
  expect(problems).toEqual([]);
});

describe("production basics", () => {
  it("reports healthy, with the database and the scheduler working", async () => {
    const response = await fetch(`${APP}/api/health`);
    const body = (await response.json()) as { ok: boolean; database: boolean; scheduler: { started: boolean } };
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, database: true, scheduler: { started: true } });
  });

  it("sends security headers and hides the framework", async () => {
    const { headers } = await fetch(APP);
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-powered-by")).toBeNull();
  });

  it("refuses changes from another site", async () => {
    const cross = { method: "POST", headers: { "sec-fetch-site": "cross-site", "content-type": "application/json" }, body: "{}" };
    expect((await fetch(`${APP}/api/collect`, cross)).status).toBe(403);
    expect((await fetch(`${APP}/api/trpc/session.remove`, cross)).status).toBe(403);
    expect(await db.company.count()).toBe(1);
  });

  it("fits a phone screen", async () => {
    fake.current.posts['"Acme"'] = [post("Acme broke our whole board")];
    await open("Feed");
    await runNow();
    await runFinished();
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(cards()).toHaveCount(1, { timeout: 10_000 });

    for (const view of ["Feed", "Dashboard", "Settings"]) {
      await page.getByLabel("Open sidebar").click();
      await page.locator(".drawer-side").getByRole("button", { name: view, exact: true }).click();
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await shot(`phone-${view.toLowerCase()}`);
      expect(overflow, `${view} scrolls sideways`).toBeLessThanOrEqual(0);
    }
  });
});

describe("a collection", () => {
  it("shows live progress, and posts appear in the feed without a reload", async () => {
    fake.current.searchDelayMs = 1500;
    fake.current.posts = {
      '"Acme"': [post("Acme ate our data, urgent"), post("Acme noise that should be filtered")],
      '"Acme review"': [post("Acme review after one year")],
      '"Acme alternative"': [post("Looking for an Acme alternative")],
    };

    await open("Feed");
    await expect(cards()).toHaveCount(0);
    await runNow();

    await expect(live()).toBeVisible({ timeout: 10_000 });
    await expect(live()).toContainText(/Searching \d of 3|Classifying/);
    await expect(sessionRow("Acme")).toContainText("Collecting", { timeout: 5_000 });

    // The first post shows up while the run is still going, on the same page.
    await expect(cards().first()).toBeVisible({ timeout: 15_000 });
    expect((await latestRun()).status).toBe("running");
    await shot("feed-during-run");

    await runFinished();
    await expect(cards()).toHaveCount(3, { timeout: 10_000 });
    await expect(live()).toBeHidden({ timeout: 15_000 });
    await expect(page.getByRole("tab", { name: /Not relevant/ })).toContainText("1", { timeout: 10_000 });

    expect(await latestRun()).toMatchObject({ status: "completed", errorCount: 0, totalNew: 4, totalRelevant: 3, totalFiltered: 1 });
    expect(fake.current.searches.sort()).toEqual([...QUERIES].sort());
    await shot("feed-after-run");
  });

  it("does not repeat a post across runs, and a dismissed post never comes back", async () => {
    const repeated = post("Acme keeps logging us out");
    fake.current.posts['"Acme"'] = [repeated];
    await open("Feed");
    await runNow();
    await runFinished();
    await expect(cards()).toHaveCount(1, { timeout: 10_000 });

    await cards().first().getByRole("button", { name: "Dismiss" }).click();
    await expect(cards()).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator(".toast")).toContainText("Post dismissed.");

    await runNow();
    await runFinished();
    await page.reload();
    await nav("Feed").click();
    await page.waitForTimeout(1000);
    await expect(cards()).toHaveCount(0);
    expect(await db.redditPost.count()).toBe(1);
    expect((await latestRun()).totalNew).toBe(0);
  });

  it("marks a post handled, and can undo it", async () => {
    fake.current.posts['"Acme"'] = [post("Acme invoice is wrong")];
    await open("Feed");
    await runNow();
    await runFinished();
    await expect(cards()).toHaveCount(1, { timeout: 10_000 });

    await cards().first().getByRole("button", { name: "Mark handled" }).click();
    await expect(cards()).toHaveCount(0, { timeout: 10_000 });

    await page.locator(".toast").getByRole("button", { name: "Undo" }).click();
    await expect(cards()).toHaveCount(1, { timeout: 10_000 });
    expect((await db.redditPost.findFirstOrThrow()).status).toBe("new");
  });

  it("filters by tab, category and urgency", async () => {
    fake.current.posts['"Acme"'] = [post("Acme urgent outage today"), post("Acme mild annoyance"), post("Acme noise elsewhere")];
    await open("Feed");
    await runNow();
    await runFinished();
    await expect(cards()).toHaveCount(2, { timeout: 10_000 });

    await page.getByLabel("Urgency").selectOption("4");
    await expect(cards()).toHaveCount(1, { timeout: 5_000 });
    await expect(cards().first()).toContainText("urgent outage");

    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(cards()).toHaveCount(2, { timeout: 5_000 });

    await page.getByLabel("Category").selectOption("praise");
    await expect(cards()).toHaveCount(0, { timeout: 5_000 });
    await page.getByLabel("Category").selectOption("all");

    await page.getByRole("tab", { name: /Not relevant/ }).click();
    await expect(cards()).toHaveCount(1, { timeout: 5_000 });
    await expect(cards().first()).toContainText("noise elsewhere");
  });
});

describe("rate limits", () => {
  it("pauses only the searches, shows the countdown, then finishes with none missed", async () => {
    fake.current.posts = {
      '"Acme"': [post("Acme first search post")],
      '"Acme review"': [post("Acme second search post")],
      '"Acme alternative"': [post("Acme third search post")],
    };
    fake.current.searchLimits['"Acme review"'] = { times: 1, retryAfterSeconds: 8 };

    await open("Dashboard");
    await runNow();

    await expect(live()).toContainText("Searches paused, continuing in", { timeout: 15_000 });
    await expect(live()).toContainText("429");
    await expect(sessionRow("Acme")).toContainText("Waiting", { timeout: 5_000 });
    await expect(page.locator("tr", { hasText: "Acme review" })).toContainText("waiting", { timeout: 5_000 });

    // The post saved before the limit is classified during the wait.
    await expect
      .poll(() => db.redditPost.count({ where: { status: "new" } }), { timeout: 8_000, intervals: [200] })
      .toBe(1);
    expect((await latestRun()).waitingUntil).not.toBeNull();
    await shot("dashboard-rate-limited");

    await runFinished();
    const run = await latestRun();
    expect(run).toMatchObject({ status: "completed", errorCount: 0, totalNew: 3, waitingUntil: null });
    expect(run.searches.every((search) => search.status === "done" && search.error === null)).toBe(true);
    expect(run.logs.map((log) => log.type)).toEqual(expect.arrayContaining(["waiting", "resumed"]));
    await expect(live()).toBeHidden({ timeout: 15_000 });
  });

  it("delays only the limited post, and shows that on its card", async () => {
    fake.current.posts['"Acme"'] = [post("Acme limited post"), post("Acme quick post one"), post("Acme quick post two")];
    // The Jev client retries a few times by itself, so this outlasts those.
    fake.current.jevLimits["Acme limited post"] = { times: 5, retryAfterSeconds: 5 };

    await open("Feed");
    await runNow();

    await expect(cards()).toHaveCount(2, { timeout: 20_000 });
    await expect(cards().first()).not.toContainText("Acme limited post");
    expect(await db.redditPost.count({ where: { status: "pending", title: "Acme limited post" } })).toBe(1);

    await page.getByRole("tab", { name: /Not classified yet/ }).click();
    await expect(page.getByText(/Rate limited, retries at/)).toBeVisible({ timeout: 45_000 });
    await shot("feed-post-rate-limited");

    await runFinished();
    expect(await db.redditPost.findFirstOrThrow({ where: { title: "Acme limited post" } })).toMatchObject({
      status: "new",
      classifyAttempts: 0,
      classifyRetryAt: null,
    });
    expect(await latestRun()).toMatchObject({ status: "completed", errorCount: 0, totalClassified: 3 });
  });

  it("carries on after the server dies during a wait", async () => {
    fake.current.posts = {
      '"Acme"': [post("Acme before the crash")],
      '"Acme review"': [post("Acme after the crash")],
      '"Acme alternative"': [post("Acme last search")],
    };
    fake.current.searchLimits['"Acme review"'] = { times: 1, retryAfterSeconds: 20 };

    await open("Dashboard");
    await runNow();
    await expect.poll(async () => (await latestRun()).waitingUntil, { timeout: 15_000, intervals: [200] }).not.toBeNull();
    const { id, waitingUntil } = await latestRun();
    const searchedBefore = fake.current.searches.length;

    stopApp();
    // A dead worker is noticed after 90 seconds without a heartbeat. This skips that wait.
    await db.collectionRun.update({ where: { id }, data: { heartbeatAt: new Date(Date.now() - 10 * 60_000) } });
    await startApp();

    await runFinished();
    const run = await latestRun();
    expect(run.id).toBe(id);
    expect(run).toMatchObject({ status: "completed", totalNew: 3, resumeCount: 0 });
    expect(run.searches.every((search) => search.status === "done")).toBe(true);
    // The finished search was not paid for twice, and nothing was asked before the wait ended.
    expect(fake.current.searches.filter((query) => query === '"Acme"')).toHaveLength(1);
    expect(fake.current.searches.length).toBe(searchedBefore + 2);
    const resumed = run.searches.find((search) => search.query === '"Acme review"')!;
    expect(resumed.startedAt!.getTime()).toBeGreaterThanOrEqual(waitingUntil!.getTime());
  });
});

describe("authors", () => {
  it("shows the picture and name, opens a post, and lists the author's other posts", async () => {
    fake.current.posts['"Acme"'] = [
      post("Acme broke on Monday", { author: "repeat_person", selftext: "Acme and u/helper_one were no help." }),
      post("Acme broke again on Friday", { author: "repeat_person" }),
    ];
    await open("Feed");
    await runNow();
    await runFinished();
    await expect(cards()).toHaveCount(2, { timeout: 10_000 });
    await page.reload();
    await nav("Feed").click();

    const card = cards().filter({ hasText: "Monday" });
    await expect(card).toContainText("Name of repeat_person", { timeout: 10_000 });
    await expect(card).toContainText("u/repeat_person");
    await expect(card).toContainText("1 other post");
    await expect(card).toContainText("Mentions");
    await expect(card).toContainText("u/helper_one");
    await expect(card.locator("img")).toHaveCount(1);
    expect(fake.current.userLookups).toEqual(["repeat_person"]);

    await card.locator("p").first().click();
    const dialog = page.locator("dialog.modal[open]");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Acme broke on Monday" })).toBeVisible();
    await expect(dialog).toContainText("4,200");
    await expect(dialog).toContainText("Other posts from u/repeat_person (1)");
    await shot("post-opened");

    await dialog.getByRole("button", { name: /Acme broke again on Friday/ }).click();
    await expect(dialog.getByRole("heading", { name: "Acme broke again on Friday" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(cards()).toHaveCount(2);
  });

  it("sends no lookups with the setting off, and respects the limit", async () => {
    fake.current.posts['"Acme"'] = [post("Acme post one"), post("Acme post two"), post("Acme post three")];
    await open("Settings");

    const toggle = page.getByLabel("Look up author profiles");
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(page.getByText("Off. No paid lookups are sent.")).toBeVisible();
    await page.reload();
    await nav("Settings").click();
    await expect(page.getByLabel("Look up author profiles")).not.toBeChecked();
    await shot("settings");

    await runNow();
    await runFinished();
    expect(fake.current.userLookups).toEqual([]);
    expect(await db.redditPost.count({ where: { status: "new" } })).toBe(3);

    await page.getByLabel("Look up author profiles").click();
    await page.getByLabel("Most lookups per run").fill("1");
    await page.getByRole("button", { name: "Save limit" }).click();
    await expect.poll(async () => (await db.appSettings.findFirstOrThrow()).authorLookupsPerRun, { timeout: 5_000 }).toBe(1);

    await runNow();
    await runFinished();
    expect(fake.current.userLookups).toHaveLength(1);
  });
});

describe("scheduling and session badges", () => {
  it("collects a session on schedule while another is open, and shows a live badge", async () => {
    const other = await seedSession("Background co", { autoCollect: true });
    fake.current.posts = {
      '"Acme"': [post("Acme scheduled post one"), post("Acme scheduled post two"), post("Acme noise scheduled")],
    };

    await open("Dashboard");
    await expect(sessionRow("Background co").getByTestId("session-new-badge")).toBeHidden();
    await settings({ autoCollectEnabled: true });

    // Nothing is pressed. The real scheduler starts the run, and the open page updates itself.
    await expect(sessionRow("Background co").getByTestId("session-new-badge")).toHaveText("2", {
      timeout: SCHEDULER_WAIT_MS + 20_000,
    });
    await expect(page).toHaveTitle(/^\(2\)/);
    await shot("session-badge");

    const run = await db.collectionRun.findFirstOrThrow({ where: { companyId: other } });
    expect(run.status).not.toBe("failed");
    // The open session is not scheduled.
    expect(await db.collectionRun.count({ where: { companyId } })).toBe(0);
    await settings({ autoCollectEnabled: false });
    await runFinished();

    // Opening it shows the posts marked as new, and clears the badge.
    await sessionRow("Background co").click();
    await expect(page).toHaveURL(new RegExp(other));
    await expect(page.getByRole("button", { name: /^Feed/ }).first()).toContainText("2", { timeout: 15_000 });
    await page.getByRole("button", { name: /^Feed/ }).first().click();
    await expect(page.getByTestId("post-new-badge")).toHaveCount(2, { timeout: 10_000 });
    await expect(sessionRow("Background co").getByTestId("session-new-badge")).toBeHidden({ timeout: 15_000 });
    await expect(page).not.toHaveTitle(/^\(/, { timeout: 15_000 });
    await shot("feed-new-badges");

    // Coming back later, they are no longer new.
    await page.reload();
    await page.getByRole("button", { name: /^Feed/ }).first().click();
    await expect(cards()).toHaveCount(2, { timeout: 10_000 });
    await expect(page.getByTestId("post-new-badge")).toHaveCount(0);
  });

  it("waits for the interval, then runs again on its own", async () => {
    await db.company.update({ where: { id: companyId }, data: { autoCollect: true } });
    await db.collectionRun.create({
      data: { companyId, status: "completed", startedAt: new Date(), completedAt: new Date() },
    });
    await settings({ autoCollectEnabled: true, collectionIntervalMins: 5 });

    // A run finished just now, so a full scheduler check passes with nothing started.
    await new Promise((resolve) => setTimeout(resolve, 35_000));
    expect(await db.collectionRun.count({ where: { companyId } })).toBe(1);

    // Six minutes later it is due.
    const earlier = new Date(Date.now() - 6 * 60_000);
    await db.collectionRun.updateMany({ where: { companyId }, data: { startedAt: earlier, completedAt: earlier } });
    await expect
      .poll(() => db.collectionRun.count({ where: { companyId } }), { timeout: SCHEDULER_WAIT_MS, intervals: [500] })
      .toBe(2);
    await settings({ autoCollectEnabled: false });
    await runFinished();
  });

  it("starts nothing with automatic collection off, but still finishes a queued run", async () => {
    await db.company.update({ where: { id: companyId }, data: { autoCollect: true } });
    await settings({ autoCollectEnabled: false });

    await new Promise((resolve) => setTimeout(resolve, 35_000));
    expect(await db.collectionRun.count()).toBe(0);

    fake.current.posts['"Acme"'] = [post("Acme queued post")];
    await db.collectionRun.create({ data: { companyId, status: "queued" } });
    await expect
      .poll(() => db.redditPost.count({ where: { status: "new" } }), { timeout: SCHEDULER_WAIT_MS, intervals: [500] })
      .toBe(1);
    await runFinished();
    expect((await latestRun()).status).toBe("completed");
  });

  it("changes the interval and the switches from Settings", async () => {
    await open("Settings");
    await page.getByLabel("Minutes between runs").fill("45");
    await page.getByRole("button", { name: "Save schedule" }).click();
    await expect.poll(async () => (await db.appSettings.findFirstOrThrow()).collectionIntervalMins, { timeout: 5_000 }).toBe(45);

    await page.getByLabel(/Collect automatically/).click();
    await expect.poll(async () => (await db.appSettings.findFirstOrThrow()).autoCollectEnabled, { timeout: 5_000 }).toBe(true);
    await page.getByLabel(/Include this session in the schedule/).click();
    await expect.poll(async () => (await db.company.findUniqueOrThrow({ where: { id: companyId } })).autoCollect, { timeout: 5_000 }).toBe(true);
    await settings({ autoCollectEnabled: false });
  });
});

describe("keywords", () => {
  it("adds and removes another name from Settings, and the searches follow", async () => {
    await open("Settings");
    const input = page.getByPlaceholder("Add another name for Acme");

    await input.fill("Acme Corp");
    await input.press("Enter");

    const row = page.getByTestId("aliases-Acme");
    await expect(row).toContainText("Acme Corp", { timeout: 5_000 });
    await expect
      .poll(async () => (await db.searchQuery.findMany({ where: { companyId } })).some((item) => item.query.includes("Acme Corp")), { timeout: 5_000 })
      .toBe(true);

    await page.reload();
    await nav("Settings").click();
    await expect(page.getByTestId("aliases-Acme")).toContainText("Acme Corp");

    await page.getByTestId("aliases-Acme").locator("button").first().click();
    await expect(page.getByTestId("aliases-Acme")).not.toContainText("Acme Corp", { timeout: 5_000 });
  });
});

describe("failures", () => {
  it("says so when the server cannot be reached, and recovers", async () => {
    await open("Dashboard");
    await expect(nav("Dashboard")).toBeVisible();
    await page.route("**/api/trpc/**", (route) => route.abort());
    await expect(page.getByText("Cannot reach the server")).toBeVisible({ timeout: 30_000 });
    await shot("disconnected");
    await page.unroute("**/api/trpc/**");
    await expect(page.getByText("Cannot reach the server")).toBeHidden({ timeout: 30_000 });
  });

  it("deletes a session after asking", async () => {
    const other = await seedSession("Delete me");
    await open("Dashboard");
    await sessionRow("Delete me").hover();
    await page.locator("button[aria-label=\"Delete Delete me\"]").click();
    await page.locator("button[aria-label=\"Confirm delete Delete me\"]").click();
    await expect(sessionRow("Delete me")).toBeHidden({ timeout: 10_000 });
    expect(await db.company.findUnique({ where: { id: other } })).toBeNull();
  });
});
