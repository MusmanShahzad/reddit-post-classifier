import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import zlib from "node:zlib";

/**
 * Local stand-ins for ScrapeBadger, Jev and OpenAI, so the end-to-end test runs
 * the real production build without spending anything. Everything they answer
 * is set by the test, including rate limits.
 */
export interface FakePost {
  id: string;
  title: string;
  selftext?: string;
  author?: string;
}

export interface FakeState {
  /** What each search returns. */
  posts: Record<string, FakePost[]>;
  /** How long a search takes, so a run can be watched. */
  searchDelayMs: number;
  /** How long a classification takes. */
  classifyDelayMs: number;
  /** Times each query answers 429 before working, and the wait it asks for. */
  searchLimits: Record<string, { times: number; retryAfterSeconds: number }>;
  /** Times a post with this title answers 429 from Jev, and the wait it asks for. */
  jevLimits: Record<string, { times: number; retryAfterSeconds: number }>;
  searches: string[];
  userLookups: string[];
  classified: string[];
}

export function freshState(): FakeState {
  return {
    posts: {},
    searchDelayMs: 0,
    classifyDelayMs: 0,
    searchLimits: {},
    jevLimits: {},
    searches: [],
    userLookups: [],
    classified: [],
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function send(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks);
  // Added in Node 22.15, which the Jev client also needs. The installed types are older.
  const { zstdDecompressSync } = zlib as unknown as { zstdDecompressSync: (data: Buffer) => Buffer };
  const text = request.headers["content-encoding"] === "zstd" ? zstdDecompressSync(raw) : raw;
  return text.length > 0 ? (JSON.parse(text.toString()) as Record<string, unknown>) : {};
}

function toRedditPost(post: FakePost) {
  const author = post.author ?? `user_${post.id}`;
  return {
    id: post.id,
    fullname: `t3_${post.id}`,
    title: post.title,
    selftext: post.selftext ?? "Tried Acme last week and it was a real problem for our team.",
    subreddit: "webdev",
    author,
    score: 7,
    num_comments: 2,
    url: `https://reddit.com/r/webdev/comments/${post.id}`,
    permalink: `/r/webdev/comments/${post.id}`,
    created_utc: Math.floor(Date.now() / 1000) - 3600,
    is_self: true,
  };
}

/** Answers Jev's questions. A post with "noise" in it scores as not relevant, and "urgent" scores high. */
function answerJev(body: Record<string, unknown>) {
  const state = String(body.state ?? "");
  const noise = /noise/i.test(state);
  const urgent = /urgent/i.test(state);
  const questions = (body.questions ?? {}) as Record<string, { type?: string; options?: Record<string, unknown> }>;

  const answers: Record<string, unknown> = {};
  for (const [id, question] of Object.entries(questions)) {
    if (question.type === "noul") {
      const negative = id === "promotional" || id === "excluded";
      answers[id] = { noul: noise ? (negative ? 0.01 : 0.02) : negative ? 0.02 : 0.96 };
    } else if (question.type === "score") {
      answers[id] = { score: urgent ? 4 : 2 };
    } else {
      const pick = { category: "complaint", sentiment: "negative", audience: "customer" }[id] ?? "other";
      answers[id] = { choice: pick, confidence: 0.9 };
    }
  }
  return { answers };
}

export function startFakeServices(state: { current: FakeState }, port: number): Promise<Server> {
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", `http://localhost:${port}`);
      const fake = state.current;

      if (url.pathname === "/reddit/search/posts") {
        const query = url.searchParams.get("q") ?? "";
        const limit = fake.searchLimits[query];
        if (limit && limit.times > 0) {
          limit.times--;
          return send(response, 429, { error: "rate_limited" }, { "Retry-After": String(limit.retryAfterSeconds) });
        }
        fake.searches.push(query);
        if (fake.searchDelayMs) await sleep(fake.searchDelayMs);
        return send(response, 200, { posts: (fake.posts[query] ?? []).map(toRedditPost) });
      }

      if (url.pathname === "/reddit/search/subreddits") {
        return send(response, 200, { subreddits: [] });
      }

      if (url.pathname.startsWith("/reddit/users/")) {
        const username = decodeURIComponent(url.pathname.split("/").pop() ?? "");
        fake.userLookups.push(username);
        return send(response, 200, {
          user: {
            id: username,
            name: username,
            total_karma: 4200,
            created_utc: 1_500_000_000,
            verified: true,
            // A real Reddit address is not needed: an inline picture keeps the test offline.
            icon_img:
              "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
            subreddit: { title: `Name of ${username}` },
          },
        });
      }

      if (url.pathname === "/jev/v1/systemone") {
        const body = await readJson(request);
        const state_ = String(body.state ?? "");
        const limited = Object.entries(fake.jevLimits).find(([title]) => state_.includes(`Title: ${title}`));
        if (limited && limited[1].times > 0) {
          limited[1].times--;
          return send(response, 429, { error: "rate_limited" }, { "Retry-After": String(limited[1].retryAfterSeconds) });
        }
        const title = /Title: (.*)/.exec(state_)?.[1];
        if (title && "category" in ((body.questions as object) ?? {})) {
          fake.classified.push(title);
          if (fake.classifyDelayMs) await sleep(fake.classifyDelayMs);
        }
        return send(response, 200, answerJev(body));
      }

      if (url.pathname === "/openai/chat/completions") {
        await readJson(request);
        return send(response, 200, {
          id: "fake",
          object: "chat.completion",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: { role: "assistant", content: "The author says Acme was a problem for their team." },
            },
          ],
        });
      }

      return send(response, 404, { error: `Nothing here: ${url.pathname}` });
    })().catch((error: unknown) => {
      send(response, 500, { error: error instanceof Error ? error.message : "Unknown" });
    });
  });

  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
