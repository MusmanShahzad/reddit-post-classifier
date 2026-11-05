# Decisions

## How we get the data, and the limits

We use **ScrapeBadger**, because Reddit's official API needs an approved developer account, which we do not have. The official API remains available as `REDDIT_PROVIDER=reddit`, and the rest of the app does not change. That path has only been tested against simulated responses, because we have no approved account to run it with.

- **Volume:** one search returns a small page of posts and costs 8 credits, so we search precisely and do not page through results. A search that returns nothing costs nothing, according to ScrapeBadger's `X-Credits-Used` header.
- **Search text follows the goal.** The session's brief is read as `own_feedback`, `competitor_feedback` or `potential_clients`. Reviews of a product use `title:"QuickBooks" OR subreddit:QuickBooks`, because a plain name search returned mostly passing mentions.
- **Time window:** each run searches the past week, sorted by relevance. A failed search is searched again next run, as long as the post still ranks among the few results returned.
- **Quiet markets:** some topics have too few posts for any one week. For pharmacy delivery, the past week returned nothing and the past year returned several on-topic posts. So a topic search that has never found anything widens to the past month and then the past year, dropping its buying words, which made those wide searches noisier. Once it has found something it goes back to the past week, so no run pays again for the same old posts. Names never widen.
- **Rate limits are handled, not just retried.** ScrapeBadger allowed 5 requests per window in our tests.
  - A limit pauses the search queue for as long as the provider asks, then continues from the same search, so no search is skipped.
  - The wait is saved, so it survives a server restart, and finished searches are not fetched or paid for twice.
  - A limit from Jev or OpenAI delays only that post, and the other posts carry on. A post that stays limited waits for the next run instead of being marked failed.
  - The dashboard shows the pause and a live countdown, and each post that is waiting shows when it will retry.
  - The official Reddit API goes through the same handling.
  - This was tested with real ScrapeBadger limits on live runs, simulated limits, and a server killed in the middle of a wait.
- **Not covered:** comments, and posts older than the time window.

## Where the data approach breaks in production

This works for a demo. It should not carry a commercial product as it is.

- **Terms and legal risk.** Reddit's official API has rate limits and terms for commercial use, and a commercial product would need an agreement with Reddit. A third-party scraper does not remove that question, it only moves it. We have not checked ScrapeBadger's right to this data, so this needs a legal review before any commercial use.
- **One vendor.** If ScrapeBadger changes its prices, breaks or shuts down, collection stops. The provider interface makes a replacement cheap to add, including the official API, which needs Reddit's approval first.
- **Missed posts.** A search returns a small page of posts, so a busy brand can have far more posts in a week than we ever see. A new post can also rank below older ones and not appear at all. Asking for more means paying for more searches. "None missed" holds for the searches we run, not for all of Reddit.
- **Rate limits.** We saw 5 requests per window, which suits one small team. A limit does not lose work, because the queue waits and then continues, but many sessions would spend much of their time waiting, and the app runs one collection at a time.
- **Cost.** Every search that returns posts costs the same, however few are useful. In our runs a search could lose most of its posts to the name check. The cost grows with sessions and how often they run, not with useful results.
- **One server.** SQLite and an in-process scheduler limit the app to one running copy. A larger version needs Postgres and a separate worker.

## How we checked the filter and the classifier

**The brief asks for an LLM, and we use Jev for this step.** This is a deliberate change. Jev is a typed-answer model, not a text-generating LLM: for each question it returns a score or one of the allowed labels, so its output always fits the expected shape. That suits filtering and labelling, and it lets each rule be its own question. An LLM still does the writing: GPT-4o-mini writes the one-line reason, and GPT-4o reads the setup details.

Jev answers one question per concept, and code combines the answers:

`relevance = min(max(about_brand, min(about_competitor, competitor_market), min(about_market, buying_intent)), 1 - excluded, 1 - promotional)`

`competitor_market` asks whether the post is about this kind of product at all. Without it, a parcel complaint scored 0.89 for a pharmacy delivery company, just because it was about FedEx.

Which questions are asked depends on the session's goal. A post with a score of 0.3 or less is skipped, and 0.7 or more is shown. Anything between is held under **Needs your check**. A post is also held when the checks disagree, such as a positive post when the user asked for complaints, or a very low match with what they asked to find.

**What was checked:**

- Automated tests cover the scoring rules, parsing of Jev's output, deduplication and the whole pipeline.
- Live searches were reviewed by hand for several goals. A reviews search for QuickBooks kept more than half of its posts, and those looked right. Potential-client searches were noisier, at about half useful for accounting and fewer for auto repair.
- When the competitor rule was added, all 41 saved posts from four sessions were re-scored with real Jev. Six verdicts changed: four off-target FedEx and UPS posts and two hiring posts, which the user had already dismissed.
- The Dashboard's filter quality card measures your own handle and dismiss decisions against the filter. It gives no score while nothing has reached the feed.

**Measured against labelled posts.** We labelled 72 real posts from four markets, by asking whether that session's team would want each one. The labels were written from the post text before any score was seen, and they were then compared with the real classifier. "Kept" includes posts held for a check, and "in the feed" means shown without one.

| Posts | Count | Wanted | Kept: precision | Kept: recall | In the feed: precision | In the feed: recall |
|---|---|---|---|---|---|---|
| **New, not seen during development** | 33 | 5 | 29% (5/17) | 100% (5/5) | 57% (4/7) | 80% (4/5) |
| Seen during development | 39 | 10 | 83% (10/12) | 100% (10/10) | 100% (9/9) | 90% (9/10) |
| All | 72 | 15 | 52% (15/29) | 100% (15/15) | 81% (13/16) | 87% (13/15) |

- **Trust the first row most.** Several rules were written while looking at the second row's posts, so those numbers flatter the filter.
- **The sample is small,** with only 15 wanted posts. One post moves the new-post figures by 14 to 20 points, so treat these as a rough guide.
- **One AI assistant wrote the labels,** not an independent person, and it also helped build the filter. Nothing was tuned after seeing these results.
- **Overall,** the filter stopped 54 of the 57 unwanted posts from reaching the feed, and it never skipped a wanted post. Its main weakness is sending too many unwanted posts to **Needs your check**. Those cost a person a moment but do not pollute the feed.
- **Category** matched on 14 of the 15 wanted posts. The miss was an angry complaint about a broken promise, labelled as a bug report.
- **The strictest test was the pharmacy courier market.** No post came from a pharmacy looking for a courier, so nothing should have been kept, but 4 of its 17 were, and 2 reached the feed. All 4 were people looking for medication delivery for themselves or a friend: on topic, but not the buyer.
- **The labelled posts are not in this repo,** because they include personal details from people's posts, such as health information. `tests/eval/filter.eval.ts` is the measurement, and `npm run eval` reruns it on a file of your own.

**Where it fails:**

| Pattern | What happens |
|---|---|
| Names that are everyday words | They need a niche word in the search, and some off-topic posts still get through |
| Suggested competitors | These come from the model's own knowledge, so they can be wrong or empty. One suggestion for Motive was its own former name, KeepTruckin. Check them on the review screen |
| Quiet markets | Reddit may simply have few posts, so a session can correctly find almost nothing |
| Posts about a competitor that are not feedback | Hiring and layoff posts are about the market, so they can still be kept |
| Author's relationship to the product | Tags can be wrong: someone still using a product was tagged as a former customer |
| Vendors and job adverts | They match a name search. The promotional question catches most but not all |
| Short posts with no body | Too little text to judge, so they tend to be held or skipped |
| Sarcasm and mixed feelings | One sentiment label is forced onto the whole post |

## What 1,000 posts cost

| Part | Basis | Per 1,000 posts |
|---|---|---|
| ScrapeBadger searches | 8 credits per search that returns posts, at the page sizes seen on live runs | about 1,150 credits |
| ScrapeBadger author profiles | 5 credits each, from its `X-Credits-Used` header, once per author of a relevant post | up to 2,000 credits if 40% of posts pass and every author is new |
| Jev | about 500 input tokens per post, at the $0.042 per million tokens noted when this was first costed | about $0.02 |
| GPT-4o-mini summaries | about 400 posts at 400 input and 50 output tokens, up to 2 drafts each | about $0.04 to $0.07 |

Convert credits at your ScrapeBadger plan's rate. The search credits are by far the largest cost, and duplicates make them higher than this, because a repeated post still uses up the search that returned it. **Check the Jev and OpenAI prices against their current price lists**, as they were not re-confirmed for this estimate.

## Decisions worth knowing

- **Three separate tracks in one run.** Searches, classification and author lookups do not block each other. A rate limit on one post delays only that post.
- **One meaning of "relevant".** It means the post is in the feed, whether new or handled. Posts held for a check are counted as "to check". A search's or run's "kept" count includes both, since those totals describe the filter, not the feed.
- **A rate limit is not a failure.** It uses up no attempts, and a post or search is retried once the wait ends. A search the source keeps failing on is given up after 6 tries, so it cannot hold the queue forever.
- **Collection is automatic by default.** Creating a session starts its first search straight away, and the schedule carries on from there. Turning off **Collect automatically** in Settings stops both.
- **A session must opt in to the schedule.** New sessions are in. Sessions created before this setting existed collect only while they are open, so upgrading does not start spending on old sessions.
- **The UI polls every 2 to 3 seconds** rather than holding a live connection. That keeps working through restarts and needs no extra infrastructure, and it fits a single-server app.
- **Author history reads saved posts only.** Fetching a user's full Reddit history would be a paid request for every post opened.
- **SQLite and one process.** This is simple to run but limits the app to one server. Moving to Postgres and a separate worker is the path to more than that.

## Assumptions

- One team uses the app, so no accounts or permissions. This was out of scope in the brief, and it means the app must not be exposed publicly as it is.
- "Mentions" means the tracked brands and competitors a post names, plus any `u/name` it refers to.
- A dismissed post stays hidden everywhere, including in an author's post history. Undo appears for a few seconds after dismissing, in case of a misclick.
- Some things go beyond the brief because they helped with testing or with real use: several sessions, author profiles, the filter quality card, and Storybook. None of them are needed for the core flow.

## What is next

1. **A larger labelled set,** of a few hundred posts labelled by someone independent, with a held-back part, to tune the thresholds and tighten who counts as the buyer.
2. **Login**, before the app is reachable from outside a private network.
3. **Database migrations** instead of `prisma db push`, so schema changes can be reviewed and rolled back.
4. **Dependency upgrades.** `npm audit` still reports issues in Next.js 15 and Zod 3 that need major version upgrades.
5. **Comment monitoring**, since comments often hold the most useful feedback.
