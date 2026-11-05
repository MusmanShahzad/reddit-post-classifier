"use client";

import { useEffect, useRef } from "react";
import { ArrowUp, MessageSquare, Sparkles, X } from "lucide-react";
import { api } from "@/trpc/react";
import { AudienceBadge, CategoryBadge, SentimentBadge, UrgencyBadge } from "@/components/atoms";
import { PostActions, PostMentions } from "@/components/molecules";
import { PostAuthor } from "@/components/organisms";
import { readableError } from "@/lib/trpc-error";
import { timeAgo } from "@/lib/types";

const WAITING_POLL_MS = 2000;

const STATUS_LABEL: Record<string, string> = {
  pending: "Not classified yet",
  review: "Needs your check",
  filtered: "Not relevant",
  handled: "Handled",
  error: "Could not classify",
};

function accountAge(created: Date): string {
  const months = Math.floor((Date.now() - new Date(created).getTime()) / (30.44 * 86_400_000));
  if (months < 1) return "under a month";
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"}`;
  const years = Math.floor(months / 12);
  return `${years} ${years === 1 ? "year" : "years"}`;
}

export interface PostDetailProps {
  postId: string;
  onSelectPost: (postId: string) => void;
  onClose: () => void;
  onHandle: (postId: string) => void;
  onDismiss: (postId: string) => void;
  onReopen: (postId: string) => void;
  actionsDisabled?: boolean;
}

/** An opened post: the full text, who wrote it, what it mentions, and the author's other saved posts. */
export function PostDetail({
  postId,
  onSelectPost,
  onClose,
  onHandle,
  onDismiss,
  onReopen,
  actionsDisabled = false,
}: PostDetailProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { data, isLoading, error } = api.post.getPostDetail.useQuery(
    { postId },
    {
      // Keeps the opened post current while it is still being classified.
      refetchInterval: (query) =>
        query.state.data?.post.status === "pending" ? WAITING_POLL_MS : false,
    },
  );

  useEffect(() => {
    // No close on cleanup: leaving the page closes it, and a close event here would close the post.
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  useEffect(() => {
    dialog.current?.querySelector(".modal-box")?.scrollTo({ top: 0 });
  }, [postId]);

  const post = data?.post;
  const profile = post?.authorProfile;
  const scored = post?.status !== "filtered";
  const loadError = readableError(error);

  return (
    <dialog ref={dialog} className="modal" aria-labelledby="post-detail-title" onClose={onClose}>
      <div className="modal-box max-w-2xl">
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-square absolute top-3 right-3"
          aria-label="Close"
          onClick={onClose}
        >
          <X className="size-4" aria-hidden />
        </button>

        {isLoading && (
          <div className="flex justify-center py-12">
            <span className="loading loading-spinner" aria-label="Loading post" />
          </div>
        )}

        {loadError && (
          <div role="alert" className="alert alert-error alert-soft mt-8">
            <span>{loadError}</span>
          </div>
        )}

        {post && (
          <div className="flex flex-col gap-4">
            <div className="pr-10">
              <PostAuthor post={post} size="lg" />
            </div>

            {profile?.fetchedAt && profile.totalKarma !== null && (
              <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-base-content/70">
                <div className="flex gap-1">
                  <dt>Karma</dt>
                  <dd className="font-medium">{profile.totalKarma.toLocaleString()}</dd>
                </div>
                {profile.createdUtc && (
                  <div className="flex gap-1">
                    <dt>Account age</dt>
                    <dd className="font-medium">{accountAge(profile.createdUtc)}</dd>
                  </div>
                )}
                {profile.verified && <dd className="badge badge-ghost badge-xs">Verified</dd>}
                {profile.isEmployee && <dd className="badge badge-ghost badge-xs">Reddit employee</dd>}
              </dl>
            )}

            <div className="flex flex-wrap items-center gap-2 text-xs text-base-content/60">
              {scored && post.urgency && <UrgencyBadge urgency={post.urgency} />}
              <span>r/{post.subreddit}</span>
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
              {STATUS_LABEL[post.status] && (
                <span className="badge badge-ghost badge-sm">{STATUS_LABEL[post.status]}</span>
              )}
            </div>

            <h3 id="post-detail-title" className="text-lg font-bold">
              {post.title}
            </h3>

            {post.body && <p className="text-sm break-words whitespace-pre-wrap text-base-content/80">{post.body}</p>}

            <PostMentions mentions={data.mentions} />

            <div className="flex flex-wrap items-center gap-2 empty:hidden">
              {scored && post.category && <CategoryBadge category={post.category} />}
              {scored && post.sentiment && <SentimentBadge sentiment={post.sentiment} />}
              {scored && post.audienceTag && <AudienceBadge audienceTag={post.audienceTag} />}
            </div>

            {post.reason && (
              <div className="alert alert-soft">
                <Sparkles className="size-4 shrink-0" aria-hidden />
                <span>{post.reason}</span>
              </div>
            )}

            <PostActions
              status={post.status}
              permalink={post.permalink}
              onHandle={() => onHandle(post.id)}
              onDismiss={() => onDismiss(post.id)}
              onReopen={() => onReopen(post.id)}
              disabled={actionsDisabled}
            />

            {post.author !== "[deleted]" && (
              <section className="border-t border-base-300 pt-4">
                <h4 className="mb-2 text-sm font-semibold">
                  Other posts from u/{post.author}
                  {data.otherPostCount > 0 && ` (${data.otherPostCount})`}
                </h4>
                {data.otherPosts.length === 0 ? (
                  <p className="text-sm text-base-content/60">No other posts from this user have been saved yet.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {data.otherPosts.map((other) => (
                      <li key={other.id}>
                        <button
                          type="button"
                          className="w-full rounded-box p-2 text-left hover:bg-base-200"
                          onClick={() => onSelectPost(other.id)}
                        >
                          <span className="block text-sm font-medium">{other.title}</span>
                          <span className="flex flex-wrap items-center gap-2 text-xs text-base-content/60">
                            <span>r/{other.subreddit}</span>
                            <span>·</span>
                            <span>{timeAgo(other.redditCreatedAt)}</span>
                            {STATUS_LABEL[other.status] && <span>· {STATUS_LABEL[other.status]}</span>}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {data.otherPostCount > data.otherPosts.length && (
                  <p className="mt-2 text-xs text-base-content/60">
                    Showing the latest {data.otherPosts.length}.
                  </p>
                )}
              </section>
            )}
          </div>
        )}
      </div>
      <form method="dialog" className="modal-backdrop">
        <button type="submit" aria-label="Close post">
          Close
        </button>
      </form>
    </dialog>
  );
}
