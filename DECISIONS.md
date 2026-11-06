# Decisions

## Accuracy

We froze the filter and tested it on posts it had never seen, from eight markets.

| Result | Number |
|---|---|
| Posts fetched from Reddit | 270 |
| Unique posts judged, after removing duplicates and posts without the name | 150 |
| Posts a team would want | 28 |
| **Overall accuracy** (right call on showing or hiding a post) | **91%** (137/150) |
| **Success ratio** (feed posts that were right) | **71%** (25/35) |
| Wanted posts that reached the feed | 89% (25/28) |
| Wanted posts lost | 0 (the other 3 waited under **Needs your check**) |
| Unwanted posts kept out of the feed | 92% (112/122) |
| Correct category on wanted posts | 82% (23/28) |

**Read these with care:**

- Trust the success ratio most. Most posts are unwanted, so hiding every post would still score 81% overall.
- The sample is small. Feed success is likely between 55% and 84%.
- An AI assistant labelled the posts and also helped build the filter, so this is not an independent test. It locked the labels before scoring, and the filter was not changed afterwards.
- To reach 150 posts, the test also searched the past month and year. Scheduled runs search the past week.

`npm run eval` reruns the measurement on your own labelled file, set with `EVAL_FILE`. The test posts are not in this repo, because they include personal details.

## Where the filter fails

| Pattern | What happens |
|---|---|
| How-to questions | A plain question about a product can reach the feed as feedback |
| Vendors posing as reviewers | "I compared 7 tools" posts can look like buyers |
| Names that are everyday words | They need a niche word in the search, and some off-topic posts still get through |
| Loosely worded buyer | No wanted post is lost, but more wait for a check |
| Unsure posts labelled "other" | These are skipped, so a useful one could be lost |
| Suggested competitors | They come from the model and can be wrong, so check them on the review screen |
| Sarcasm and mixed feelings | One sentiment label is forced onto the whole post |

## How the filter works

The brief asks for an LLM, and we use **Jev** for filtering and labels. This is a deliberate change. Jev returns a score or an allowed label for each question, so its output always fits the expected shape. GPT-4o-mini writes the one-line reason, and GPT-4o reads the setup details.

Code combines Jev's answers into one score:

- **0.3 or less:** skipped.
- **0.7 or more:** shown, unless a check disagrees.
- **In between:** held under **Needs your check**, unless Jev labels its purpose "other".
- **Buyer check:** when a session names its buyer, a clear no skips a lead, and a doubtful answer holds it.

Automated tests cover scoring, parsing of Jev's output, deduplication and the whole pipeline. We have not compared Jev with an LLM on the same posts.

## Getting the data

We use **ScrapeBadger**, because Reddit's official API needs an approved developer account. `REDDIT_PROVIDER=reddit` switches to the official API, but that path has only been tested against simulated responses.

- **Searches:** each search returns a small page of posts and costs 8 credits. An empty search costs nothing. Runs search the past week, and a topic that has never found anything widens to the past month and year.
- **Rate limits:** a limit pauses the search queue for as long as the provider asks, then continues from the same search, so none is skipped. The wait survives a restart, and finished searches are not paid for twice.
- **Classifier limits:** a limit from Jev or OpenAI delays only that post. The dashboard shows each wait with a countdown.
- **Tested with:** real ScrapeBadger limits on live runs, simulated limits, and a server killed mid-wait.

## Where this breaks in production

- **Terms:** a commercial product needs an agreement with Reddit. A scraper does not remove that question, and this needs a legal review.
- **One vendor:** collection stops if ScrapeBadger changes or shuts down.
- **Missed posts:** a busy brand can have far more posts than a small search page returns. "None missed" holds only for the searches we run.
- **Rate limits:** we saw 5 requests per window. No work is lost, but many sessions would spend most of their time waiting.
- **One server:** SQLite and an in-process scheduler limit the app to one running copy. More needs Postgres and a separate worker.
- **No login:** this was out of scope, so the app must not be exposed publicly.

## Cost per 1,000 posts

| Part | Estimate |
|---|---|
| ScrapeBadger searches | About 1,150 credits, and more when many results are duplicates |
| ScrapeBadger author profiles | Up to 2,000 credits if 40% of posts pass and every author is new |
| Jev | About $0.02 |
| GPT-4o-mini reasons | About $0.04 to $0.07 |

Searches and profiles are the largest costs. Jev and OpenAI prices were not re-checked for this estimate, so check them against the current price lists.

## What is next

1. **Independent labels:** have a person check the test labels, then measure any fix on a new set of posts.
2. **Filter fixes:** handle how-to questions and vendors posing as reviewers.
3. **Jev compared with an LLM:** run both on the same labelled posts.
4. **Login and database migrations:** needed before the app leaves a private network.
5. **Dependency upgrades:** `npm audit` reports issues in Next.js 15 and Zod 3 that need major upgrades.
6. **Comments:** monitor them, since they often hold the most useful feedback.
7. **API key rotation:** switch to another key when one hits a rate limit, so searches finish faster. First check that the provider's terms allow this.
8. **Customer history:** on the post detail page, use a larger AI model to gather more details and review the author's older posts. Pass that history to the classifier so it can see the customer's journey, then measure whether accuracy improves. Storing a person's history needs a privacy review.
9. **Today's summary:** in the filters, use AI to summarize today's posts and show what people are saying about the company.
10. **More Reddit coverage:** add more types of search and other ways of collecting from Reddit, so fewer posts are missed.
