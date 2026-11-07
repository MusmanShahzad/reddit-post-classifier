# Radarr: Reddit listening tool

Radarr finds Reddit posts a company cares about, drops the noise, and shows what is worth acting on.

1. **Set up a session.** Describe the company, what it sells, and what to find. Radarr suggests competitors, topics, and subreddits for you to check.
2. **Collect.** Searches run on a schedule, or when you press the button. A post is never saved twice, and a dismissed post never comes back.
3. **Classify.** Jev decides whether each post is relevant and labels its category, sentiment, urgency, and audience. GPT-4o-mini writes a one-line reason for each post that passes.
4. **Act.** The feed updates live. Filter it, open a post to see its author and their other posts, then mark it handled or dismiss it.

## Quick start

You need **Node.js 22.15 or newer** (required by the Jev client) and three API keys. The tested version is in `.nvmrc`. With [nvm](https://github.com/nvm-sh/nvm), run `nvm install` and then `nvm use` inside the project folder. With nvm for Windows, run `nvm install 24.12.0` and then `nvm use 24.12.0`.

### 1. Install

```bash
git clone https://github.com/MusmanShahzad/reddit-post-classifier.git
cd reditt-post-classifier
npm install
cp .env.example .env
```

On Windows Command Prompt, use `copy .env.example .env` for the last line.

### 2. Get your three API keys

Paste each one into `.env`, after the `=` on its line.

**`SCRAPEBADGER_API_KEY`**, which fetches Reddit posts:
1. Sign up at [scrapebadger.com/auth/signup](https://scrapebadger.com/auth/signup). No credit card is needed, and sign-up includes free credits.
2. Open [the API keys page](https://scrapebadger.com/dashboard/api-keys) and create a key.

**`TYPESAFE_API_KEY`**, for Jev, which filters and labels posts:
1. Create an account or sign in at [console.typesafe.ai](https://console.typesafe.ai).
2. Open the API Keys section and create a key.

**`OPENAI_API_KEY`**, which sets up sessions and writes the one-line reasons:
1. Sign in at [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
2. Click **Create new secret key**.
3. Make sure the account has billing credit.

All other values in `.env.example` work as-is. If `DATABASE_URL` is missing or blank, the app uses `file:./dev.db`. The Reddit client ID and secret are only for the optional official API.

### 3. Start the app

```bash
npm run db:push
npm start
```

`npm start` builds the app first when there is no build or the code has changed, which takes a minute or two. Open [http://localhost:3000](http://localhost:3000) once it says it is ready. For development, use `npm run dev` instead of `npm start`.

**A fresh clone opens with demo data.** The first `npm run db:push` copies `prisma/demo.db` to `prisma/dev.db`, so you can see the test sessions, their posts and the search results straight away. It never replaces an existing `prisma/dev.db`. Raw Reddit data and contact details are removed from the demo data. To start empty instead, set `DATABASE_URL="file:./fresh.db"` in `.env` before running it.

**The scheduler is on, but the demo sessions are not part of it,** so they spend nothing until you press **Run collection** on one. A session you create joins the schedule straight away.

### 4. Set up what to track

1. Press **New** in the sidebar if the app opens on the demo data. Enter the company name, what it sells, and what to find. Press **Continue**.
2. On the review screen, check the brand's other names, competitors, topics, and subreddits. Remove anything that does not fit, or add what is missing. You can change all of these later in Settings, including competitor names.
3. Press **Start monitoring**.

### 5. Trigger a collection run

There are three ways, and you only need one:

- **Do nothing.** Pressing **Start monitoring** starts the first run straight away, and the schedule then runs it every 30 minutes. The Dashboard counts down to the next run. You can change the interval in Settings.
- **Press Run collection** on the Dashboard.
- **Call the endpoint.** This runs the session that is open:

```bash
curl -X POST http://localhost:3000/api/collect
```

Running it again does not create duplicates. Watch the progress on the Dashboard, then open **Feed** to filter posts by category and urgency, and mark them as handled or dismissed.

**A new session starts spending as soon as you create it.** **Collect automatically** in Settings stops the scheduled runs that follow, but not the first run.

## What it costs

ScrapeBadger charges **8 credits per search that returns posts**, nothing for a search that returns none, and **5 credits per author profile**. Settings shows the most your session can spend. To reduce it:

- Raise the minutes between runs, or turn off **Collect automatically**.
- Turn off **Include this session in the schedule** for sessions you only check now and then.
- Turn off **Look up author profiles**, or lower the limit per run. Posts will then show the username without a picture.

See [DECISIONS.md](./DECISIONS.md) for the full breakdown.

## Running it in production

- **It needs one long-running server.** The scheduler and the worker live in the app's process, and the database is a SQLite file. It will not work on serverless hosting, and you should not run two copies against one database. Use a VM or a container with a persistent disk.
- **Put login in front of it.** The app has no accounts, so anyone who can reach it can read posts, delete sessions, and spend your credits. Keep it on a private network or behind an authenticating proxy.
- **Back up the database.** All your data is in the file `DATABASE_URL` points to. Point it at the persistent disk, using an absolute path.
- **Monitor `/api/health`.** It answers 200 when the database and the scheduler are working, and 503 when they are not.
- **After upgrading,** run `npm run db:push` to apply schema changes, then restart with `npm start`, which rebuilds the app. New columns are safe to add. Read Prisma's warnings if it reports anything else.

A restart is safe at any time. Finished searches aren't fetched or paid for again, and a rate-limit wait resumes where it left off.

## Tests

```bash
npm test
npm run test:e2e
npm run typecheck
```

- `npm test` runs the unit and database tests. It needs no keys and spends nothing.
- `npm run eval` measures the filter against a file of labeled posts, using real Jev calls, so it needs your key. See `DECISIONS.md` for the results and the file's location.
- `npm run test:e2e` builds the app and drives the production build in a real browser, including the real scheduler. It takes about 5 minutes and spends nothing, because ScrapeBadger, Jev and OpenAI are local stand-ins. If Chromium is missing, run `npx playwright install chromium`. Screenshots go to `e2e-artifacts/`.

## How it is built

Next.js 15, tRPC, Prisma with SQLite, Tailwind CSS with daisyUI.

```
Scheduler or Run button
        |
        v
Search queue, one at a time ---> saves new posts as "pending"
   A rate limit pauses only this.          |
                                           v
                        Classification, 5 posts at once
                        A rate limit delays only that post.
                                           |
                                           v
                        Author profiles, after the searches finish
```

| Where | What |
|---|---|
| `src/server/services/collector.ts` | Runs the search and classification tracks for one run |
| `src/server/services/search-queue.ts` | The durable queue, waits and crash recovery |
| `src/server/services/scheduler.ts` | Decides which session is due |
| `src/server/services/classifier.ts` | Jev questions and scoring |
| `src/server/services/authors.ts` | Author profile lookups |
| `src/server/services/reddit/` | ScrapeBadger and the official Reddit API |
| `src/app/_components/` | Screens |
| `src/components/` | Shared UI, as atoms, molecules, organisms and templates |
| `tests/e2e/` | The end-to-end test and its stand-in services |

## License

MIT
