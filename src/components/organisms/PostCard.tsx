import { useState } from "react";
import { ArrowUp, MessageSquare, Sparkles } from "lucide-react";
import { AuthorAvatar, UrgencyBadge, CategoryBadge, SentimentBadge, AudienceBadge } from "@/components/atoms";
import { PostActions, PostMentions } from "@/components/molecules";
import type { PostMentions as Mentions } from "@/lib/mentions";
import { timeAgo } from "@/lib/types";

/**
 * A full Reddit post card as displayed in the Feed.
 *
 * Combines urgency / category / sentiment badges, post metadata, body preview,
 * a one-liner AI reason, and action buttons into a single card.
 *
 * @param post         - The post data (from Prisma `RedditPost` model).
 * @param onHandle     - Callback to mark post as handled.
 * @param onDismiss    - Callback to dismiss post.
 * @param onReopen     - Callback to reopen a handled post.
 * @param onMarkRelevant - Saves the user's reason and moves a filtered post into the feed.
 * @param onOpen       - Opens the post with its author's details and other posts.
 *
 * @example
 * ```tsx
 * <PostCard
 *   post={post}
 *   onHandle={() => updateStatus({ postId: post.id, status: "handled" })}
 *   onDismiss={() => updateStatus({ postId: post.id, status: "dismissed" })}
 *   onReopen={() => updateStatus({ postId: post.id, status: "new" })}
 * />
 * ```
 */
export interface PostData {
  id: string;
  title: string;
  body: string;
  subreddit: string;
  permalink: string;
  redditScore: number;
  numComments: number;
  redditCreatedAt: Date;
  status: string;
  urgency: number | null;
  category: string | null;
  sentiment: string | null;
  reason: string | null;
  audienceTag?: string | null;
  /** The search that found this post. */
  matchedQuery?: string | null;
  author?: string;
  /** Empty until the author's profile has been looked up. */
  authorProfile?: { displayName: string | null; iconUrl: string | null } | null;
  /** This author's saved posts in the session, including this one. */
  authorPostCount?: number;
  mentions?: Mentions | null;
  /** Set while a rate limit has delayed this post's classification. */
  classifyRetryAt?: Date | null;
  /** Arrived since the feed was last opened. */
  isNew?: boolean;
}

/** The left edge shows urgency at a glance, so the feed can be scanned. */
function urgencyEdge(urgency: number | null): string {
  if (!urgency || urgency < 3) return "";
  return urgency >= 4 ? "border-l-4 border-l-error" : "border-l-4 border-l-warning";
}

const DELETED_AUTHOR = "[deleted]";

/** A search built with operators means nothing to a reader. Mentions already show the names it found. */
const SEARCH_SYNTAX = /\bOR\b|\bAND\b|\w+:|[()]/;

/** Clicks on these do their own job and do not open the post. */
const INTERACTIVE = "a, button, input, textarea, select, label, form";

/** Who wrote a post: picture, profile name, and username. */
export function PostAuthor({
  post,
  size = "sm",
}: {
  post: Pick<PostData, "author" | "authorProfile">;
  size?: "sm" | "lg";
}) {
  if (!post.author) return null;
  const deleted = post.author === DELETED_AUTHOR;
  const handle = deleted ? "Deleted user" : `u/${post.author}`;
  const name = post.authorProfile?.displayName;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <AuthorAvatar username={post.author} iconUrl={post.authorProfile?.iconUrl} size={size} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className={`truncate font-medium ${size === "lg" ? "text-base" : "text-sm"}`}>{name ?? handle}</span>
        {name && <span className="truncate text-xs text-base-content/60">{handle}</span>}
      </span>
    </div>
  );
}

export interface PostCardProps {
  post: PostData;
  onHandle: () => void;
  onDismiss: () => void;
  onReopen: () => void;
  onMarkRelevant?: (reason: string) => void;
  onOpen?: () => void;
  actionsDisabled?: boolean;
}

export function PostCard({
  post,
  onHandle,
  onDismiss,
  onReopen,
  onMarkRelevant,
  onOpen,
  actionsDisabled = false,
}: PostCardProps) {
  const [reasonText, setReasonText] = useState("");
  const scored = post.status !== "filtered";
  const otherPosts = (post.authorPostCount ?? 1) - 1;
  const retryAt = post.classifyRetryAt ? new Date(post.classifyRetryAt) : null;
  const rateLimited = post.status === "pending" && retryAt !== null && retryAt.getTime() > Date.now();

  return (
    <article
      className={`card card-border animate-rise-in bg-base-100 transition-all duration-300 hover:shadow-md ${scored ? urgencyEdge(post.urgency) : ""} ${post.isNew ? "ring-1 ring-primary/40" : ""} ${onOpen ? "cursor-pointer" : ""}`}
      onClick={(event) => {
        if (!onOpen || (event.target as Element).closest(INTERACTIVE)) return;
        // Selecting text to copy it should not open the post.
        if (window.getSelection()?.toString()) return;
        onOpen();
      }}
    >
      <div className="card-body gap-3">
        {post.author && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <PostAuthor post={post} />
            {post.isNew && <span className="badge badge-primary badge-sm" data-testid="post-new-badge">New</span>}
            {otherPosts > 0 && (
              <span className="badge badge-ghost badge-sm">
                {otherPosts} other {otherPosts === 1 ? "post" : "posts"}
              </span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs text-base-content/60">
          {scored && post.urgency && <UrgencyBadge urgency={post.urgency} />}
          <span>r/{post.subreddit}</span>
          {post.status === "filtered" && (
            <span className="badge badge-ghost badge-sm">Not relevant</span>
          )}
          {post.status === "review" && (
            <span className="badge badge-warning badge-soft badge-sm">Needs your check</span>
          )}
          {post.status === "pending" && (
            <span className="badge badge-warning badge-sm">
              {rateLimited ? `Rate limited, retries at ${retryAt.toLocaleTimeString()}` : "Not classified yet"}
            </span>
          )}
          {post.matchedQuery && !SEARCH_SYNTAX.test(post.matchedQuery) && (
            <span className="badge badge-outline badge-sm">{post.matchedQuery.replace(/^"|"$/g, "")}</span>
          )}
          <span>·</span>
          <span>{timeAgo(post.redditCreatedAt)}</span>
          <span>·</span>
          <span className="inline-flex items-center gap-1">
            <ArrowUp className="size-3.5" aria-hidden />
            {post.redditScore}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="size-3.5" aria-hidden />
            {post.numComments}
          </span>
        </div>

        <h3 className="card-title text-base">
          {onOpen ? (
            <button type="button" className="text-left hover:underline" onClick={onOpen}>
              {post.title}
            </button>
          ) : (
            post.title
          )}
        </h3>

        {post.body && (
          <p className="line-clamp-2 text-sm text-base-content/80">{post.body}</p>
        )}

        <PostMentions mentions={post.mentions} />

        <div className="flex flex-wrap items-center gap-2">
          {scored && post.category && <CategoryBadge category={post.category} />}
          {scored && post.sentiment && <SentimentBadge sentiment={post.sentiment} />}
          {scored && post.audienceTag && <AudienceBadge audienceTag={post.audienceTag} />}
        </div>

        {post.reason && (
          <div role="alert" className="alert alert-soft">
            <Sparkles className="size-4 shrink-0" aria-hidden />
            <span>{post.reason}</span>
          </div>
        )}

        {post.status === "filtered" && onMarkRelevant && (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const reason = reasonText.trim();
              if (reason.length < 8) return;
              onMarkRelevant(reason);
              setReasonText("");
            }}
          >
            <label className="text-sm text-base-content/70" htmlFor={`reason-${post.id}`}>
              Why is this relevant?
            </label>
            <textarea
              id={`reason-${post.id}`}
              className="textarea w-full"
              rows={2}
              value={reasonText}
              onChange={(event) => setReasonText(event.target.value)}
              placeholder="One line on why this post matters"
            />
            <button
              type="submit"
              className="btn btn-sm self-start"
              disabled={actionsDisabled || reasonText.trim().length < 8}
            >
              Mark relevant
            </button>
          </form>
        )}

        <div className="card-actions">
          <PostActions
            status={post.status}
            permalink={post.permalink}
            onHandle={onHandle}
            onDismiss={onDismiss}
            onReopen={onReopen}
            disabled={actionsDisabled}
          />
        </div>
      </div>
    </article>
  );
}
