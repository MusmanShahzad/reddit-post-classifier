# 🔴 Radarr — Reddit Listening Tool

A social listening tool that finds Reddit conversations a company cares about, filters out noise using AI, and shows what's worth acting on.

## What It Does

1. **Smart Onboarding** — Chat with Radarr to describe your company. It extracts brand names, competitors, topics, and suggests subreddits using GPT-4o
2. **Collect from Reddit** — Fetches matching posts via Reddit's API with auto-generated search queries. Deduplicates across runs
3. **AI Classification** — Uses TypeSafe AI's Jev model for instant structured classification (category, sentiment, urgency) and GPT-4o-mini for one-line summaries
4. **Actionable Feed** — Filterable feed of relevant posts. Mark as handled or dismiss. Dismissed posts never return

## Quick Start (5 minutes)

### Prerequisites
- **Node.js 22+** (required for TypeSafe SDK)
- **npm**

### 1. Clone and Install

```bash
git clone <repo-url>
cd radarr
npm install
```

### 2. Get Your API Keys

You need 3 API keys (all free or pay-as-you-go):

#### Reddit API (free, 2 minutes)
1. Go to [reddit.com/prefs/apps](https://reddit.com/prefs/apps)
2. Click **"create another app..."**
3. Choose **"script"** type
4. Set redirect URI to `http://localhost:3000`
5. Copy the **client ID** (under app name) and **secret**

#### TypeSafe AI / Jev (1 minute)
1. Go to [console.typesafe.ai](https://console.typesafe.ai)
2. Create an account → API Keys → Create new key
3. Copy the key

#### OpenAI (1 minute)
1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create a new secret key
3. Ensure you have at least $5 in credits

### 3. Configure

```bash
cp .env.example .env
# Edit .env with your 4 API key values
```

### 4. Initialize Database

```bash
npx prisma db push
```

### 5. Start

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 6. Trigger a Collection

**Option A**: Use the dashboard UI — click "🔄 Run Collection Now"

**Option B**: API call:
```bash
curl -X POST http://localhost:3000/api/collect
```

## Running Tests

```bash
npm test
```

42 tests covering deduplication, Jev output parsing, query generation, and guardrail validation.

## Architecture

### Tech Stack
- **Framework**: Next.js 14+ (App Router) with TypeScript
- **API**: tRPC for type-safe client-server communication
- **Database**: SQLite via Prisma (zero setup)
- **UI**: Tailwind CSS + shadcn/ui
- **Classification**: TypeSafe AI Jev (structured) + OpenAI GPT-4o-mini (summaries)
- **Onboarding**: OpenAI GPT-4o (extraction) with 4-layer guardrails

### Classification Pipeline
```
Reddit API → Fetch posts → Deduplicate → Store
                                            ↓
                          Jev (relevance + category + sentiment + urgency)
                                            ↓
                          GPT-4o-mini (one-line summary, relevant posts only)
                                            ↓
                                    Feed (filterable UI)
```

### Cost
~$0.06 per 1,000 posts processed. See [DECISIONS.md](./DECISIONS.md) for full breakdown.

## Project Structure

```
src/
├── app/
│   ├── page.tsx                 ← Entry point (routes to onboarding or dashboard)
│   ├── api/collect/route.ts     ← SSE endpoint for collection with live progress
│   └── _components/
│       ├── onboarding-chat.tsx  ← Chat-based setup wizard
│       ├── app-shell.tsx        ← Main app layout with tabs
│       ├── dashboard.tsx        ← Stats, category breakdown, collection controls
│       ├── feed.tsx             ← Filterable post feed with actions
│       └── settings.tsx         ← Keyword/subreddit/query management
├── server/
│   ├── api/routers/
│   │   ├── onboarding.ts       ← Chat processing, config saving, guardrails
│   │   ├── post.ts             ← Feed queries, stats, status updates
│   │   ├── collector.ts        ← Collection run queries
│   │   └── settings.ts         ← CRUD for keywords, subreddits, queries
│   └── services/
│       ├── reddit.ts            ← Reddit OAuth2 + search API
│       ├── classifier.ts       ← TypeSafe Jev integration
│       ├── openai.ts           ← GPT-4o/mini + Moderation API
│       └── collector.ts        ← Collection orchestrator (async generator with SSE events)
├── lib/types.ts                 ← Shared constants, labels, utilities
└── components/ui/               ← shadcn/ui components
tests/
├── deduplication.test.ts        ← Post dedup across runs and queries
├── jev-parser.test.ts           ← Jev output parsing and urgency normalization
├── query-generation.test.ts     ← Keyword → Reddit search query expansion
└── guardrails.test.ts           ← Zod schema validation and input checks
```

## License

MIT
