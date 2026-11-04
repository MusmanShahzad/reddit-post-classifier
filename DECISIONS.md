# DECISIONS.md — Radarr Architecture Decisions

## How We Get the Data

### Reddit API (OAuth2 Application-Only Auth)
We use Reddit's official API with **client credentials** (application-only) OAuth2 flow. This is the simplest possible setup — no user login required, just a client ID and secret.

- **Endpoint**: `GET https://oauth.reddit.com/search.json?q=...`
- **Rate limit**: 100 requests/minute
- **Auth**: `POST https://www.reddit.com/api/v1/access_token` with `grant_type=client_credentials`
- **Token lifetime**: ~24 hours, auto-refreshed

### Where This Breaks in Production
| Issue | Impact | Mitigation |
|-------|--------|------------|
| **100 req/min rate limit** | Can't monitor many brands simultaneously | Use Reddit's commercial API or data providers like Arctic Shift |
| **Search API caps at ~1,000 results** | Can't paginate beyond ~10 pages | Supplement with subreddit-specific feeds |
| **No comment search** | Miss relevant conversations in comments | Integrate Pushshift/Arctic Shift for comment search |
| **Self-text only** | Link posts have no body to classify | Could fetch linked content, but adds complexity |
| **Application-only auth** | Can't access user-specific or private content | Fine for monitoring public discussions |
| **Terms of Service** | Commercial use of Reddit data requires explicit permission | Apply for Reddit's commercial API program |

## Classification Architecture: Jev + GPT-4o-mini Hybrid

### Why Two Models?

We use **TypeSafe AI's Jev** (System One model) for all structured classification and **OpenAI's GPT-4o-mini** for the one-line human-readable summary. This split optimizes for cost, speed, and reliability.

### Jev for Classification
Jev handles four questions per post in a single API call (~100ms):

1. **Relevance** (Noul): "Is this post genuinely about the monitored brand?" → Probability 0-1
2. **Category** (Choice): complaint / bug_report / product_idea / praise / recommendation_ask / other
3. **Sentiment** (Choice): positive / negative / neutral
4. **Urgency** (Score): 5 levels from "no response needed" to "critical"

**Why Jev instead of an LLM for classification?**
- **Cannot hallucinate**: Output is always typed and valid — no JSON parsing failures
- **Calibrated probabilities**: The relevance noul of 0.73 genuinely means 73% confidence, enabling fine-grained threshold tuning
- **Parallel evaluation**: All 4 questions evaluated in one call, no sequential token generation
- **Speed**: 70-500ms vs 1-3 seconds for GPT-4o-mini
- **Cost**: $42/billion input tokens, output tokens FREE

### GPT-4o-mini for Summaries
Only called for posts that pass the relevance filter (~40% of total). Generates a single sentence explaining why the post matters to the brand.

### GPT-4o for Onboarding
The onboarding chat uses GPT-4o (not mini) because it only runs once per setup and needs maximum quality for:
- Extracting company names, competitors, and topics from natural language
- Generating follow-up questions for ambiguous inputs
- Suggesting relevant topic keywords automatically

## How We Know the Filter and Classifier Are Any Good

### Jev Classification Quality
- Jev's probabilities are **calibrated via RLCD** (Reinforcement Learning for Calibrated Decisions) — when it says 80% confidence, it's right ~80% of the time
- Each answer includes a **confidence score** we can threshold: low confidence → flag for review
- The category Choice has 6 well-defined options with descriptive criteria, reducing ambiguity

### What We Checked
- **Relevance threshold tuning**: 0.6 noul is our default. Posts with 0.3-0.6 are in the gray zone — some relevant, some not. 0.6 errs on the side of precision (fewer false positives)
- **Category accuracy**: Tested with obvious examples — "this software is broken" correctly maps to complaint/bug_report, "any alternatives to X?" maps to recommendation_ask
- **Urgency calibration**: Posts with high Reddit scores and negative sentiment correctly get higher urgency

### Where It Still Gets It Wrong
| Pattern | Issue | Why |
|---------|-------|-----|
| Sarcasm | "Great job breaking the app AGAIN" classified as praise | Sarcasm detection is hard for all models |
| Ambiguous brand names | "Notion" (note-taking app vs. general word) | The relevance noul helps but doesn't fully solve homonyms |
| Mixed sentiment | "Love the product but the billing is terrible" | Forced into one sentiment; composite scoring could help |
| Very short posts | Title-only link posts | Not enough context for reliable classification |
| Non-English | Posts in other languages | Models trained primarily on English |

## Cost Analysis: Processing 1,000 Posts

### Jev Classification (all 1,000 posts)
- Average input: ~500 tokens per post
- Total input: 500,000 tokens
- Cost: 500K × $0.042/million = **$0.021**
- Output tokens: **FREE**

### GPT-4o-mini Summaries (400 relevant posts, ~40% pass rate)
- Input: ~400 tokens per post × 400 posts = 160,000 tokens
- Cost: 160K × $0.15/million = **$0.024**
- Output: ~50 tokens × 400 = 20,000 tokens
- Cost: 20K × $0.60/million = **$0.012**

### OpenAI Moderation (onboarding only)
- **FREE** — OpenAI's moderation endpoint has no charge

### Total: ~$0.06 per 1,000 posts
- Jev: $0.021
- GPT-4o-mini: $0.036
- **Total: $0.057**

At 10 collections/day × 500 posts = ~5,000 posts/day → **~$0.29/day** or **~$8.55/month**.

## Guardrails

### 4-Layer Defense (Industry Standard)
1. **Input validation** — Length limits, empty checks (no AI, instant)
2. **OpenAI Moderation API** — Free, catches hate/harassment/violence/NSFW
3. **Jev business check** — 2 Noul questions: "is this about a business?" and "does this target an individual?" (~100ms)
4. **GPT-4o extraction + Zod validation** — Hardened system prompt, schema-validated output

### Why Jev for Guardrails?
Jev is **architecturally immune to prompt injection** because it doesn't generate text. You can't trick it into outputting something outside its typed question set. This makes it ideal as a pre-screen before an LLM.

## Deduplication

### 3-Layer Approach
1. **In-memory dedup** — Same post appearing in multiple query results within one run → merged by Reddit ID
2. **Database unique constraint** — `redditId` is unique in the schema. Prisma upsert skips existing posts
3. **Dismissed never returns** — Posts marked as "dismissed" are permanently excluded from the feed via query filter

## What We Would Build Next

1. **Comment monitoring** — Currently we only search post titles/bodies. Comments often contain the most valuable feedback
2. **Scheduled collection** — Automatic cron job instead of manual triggers (the SSE infrastructure is ready for this)
3. **Trend detection** — Alert when a topic suddenly gets more posts or a sentiment shifts
4. **Multi-company support** — Current schema supports it, but UI is single-company
5. **Export/webhook** — Push relevant posts to Slack, email, or a CRM
6. **Confidence-gated routing** — Use Jev's confidence scores to route low-confidence classifications to human review
7. **Historical analysis** — Charts showing sentiment and volume over time
8. **Custom category definitions** — Let users define their own category criteria
