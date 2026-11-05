"use client";

import { useEffect, useRef, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import { api } from "@/trpc/react";
import { EmptyState, FeedSkeleton } from "@/components/atoms";
import { FilterBar } from "@/components/molecules";
import { PostCard, type PostData } from "@/components/organisms";
import type { FeedRelevance, FeedStatus } from "@/lib/feed-filter";
import { readableError } from "@/lib/trpc-error";
import { PostDetail } from "./post-detail";

/** How often the feed refreshes while posts are arriving. */
const LIVE_POLL_MS = 2000;
/** Slower check when posts wait for the next run and nothing is running. */
const IDLE_POLL_MS = 15_000;
const TOAST_MS = 6000;
/** Past this, someone has scrolled away from the top of the feed and could miss new posts. */
const SCROLLED_AWAY_PX = 200;

type Toast = { message: string; undoPostId?: string };

export function Feed({ initialRelevance = "relevant" }: { initialRelevance?: FeedRelevance }) {
  const [filters, setFilters] = useState({
    category: undefined as string | undefined,
    sentiment: undefined as string | undefined,
    minUrgency: undefined as number | undefined,
    status: "new" as FeedStatus,
    relevance: initialRelevance,
  });
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [arrivals, setArrivals] = useState(0);
  /** Posts classified after this are marked new. Stays fixed while the feed is open. */
  const [newSince, setNewSince] = useState<Date | null>(null);

  const utils = api.useUtils();
  const { data: lastRun } = api.collector.getLastRun.useQuery(undefined, {
    refetchInterval: (query) =>
      query.state.data?.status === "running" || query.state.data?.status === "queued" ? LIVE_POLL_MS : IDLE_POLL_MS,
  });
  const isCollecting = lastRun?.status === "running";
  const isActive = isCollecting || lastRun?.status === "queued";

  const { data: stats } = api.post.getStats.useQuery(undefined, {
    refetchInterval: (query) =>
      isActive ? LIVE_POLL_MS : (query.state.data?.pending ?? 0) > 0 ? IDLE_POLL_MS : false,
  });
  const pending = stats?.pending ?? 0;

  const {
    data,
    refetch,
    isLoading,
    isError,
    isFetching,
    isPlaceholderData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = api.post.getFeed.useInfiniteQuery(
    {
      ...filters,
      limit: 20,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: keepPreviousData,
      refetchInterval: isActive ? LIVE_POLL_MS : pending > 0 ? IDLE_POLL_MS : false,
    },
  );

  // Opening the feed clears this session's badge. What arrived since last time stays marked.
  const { data: sessions } = api.session.list.useQuery();
  const unseenHere = sessions?.sessions.find((session) => session.id === sessions.activeId)?.newPosts ?? 0;
  const markSeen = api.session.markSeen.useMutation({
    onSuccess: () => void utils.session.list.invalidate(),
  });
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    markSeen.mutate(undefined, {
      onSuccess: ({ previous }) => setNewSince(previous ? new Date(previous) : new Date(0)),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A post that arrives while the feed is open is seen, so the badge stays clear.
  useEffect(() => {
    if (newSince && unseenHere > 0 && !markSeen.isPending) markSeen.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newSince, unseenHere]);

  // Tells someone further down the feed that posts came in above them.
  const lastOpen = useRef<number | null>(null);
  const open = stats?.open;
  useEffect(() => {
    if (open === undefined) return;
    const before = lastOpen.current;
    lastOpen.current = open;
    if (before !== null && open > before && window.scrollY > SCROLLED_AWAY_PX) {
      setArrivals((count) => count + (open - before));
    }
  }, [open]);

  useEffect(() => {
    if (!arrivals) return;
    const clear = () => {
      if (window.scrollY <= SCROLLED_AWAY_PX) setArrivals(0);
    };
    window.addEventListener("scroll", clear, { passive: true });
    return () => window.removeEventListener("scroll", clear);
  }, [arrivals]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  // Stats and the feed both change when a post changes, so refresh both.
  const refreshAll = () => {
    void refetch();
    void utils.post.getStats.invalidate();
    void utils.post.getFilterQuality.invalidate();
    void utils.post.getPostDetail.invalidate();
  };
  const updateStatus = api.post.updateStatus.useMutation({
    onSuccess: (_post, { status, postId }) => {
      // A dismissed post is gone, so its opened view closes too.
      if (status === "dismissed") setOpenPostId((current) => (current === postId ? null : current));
      if (status === "dismissed") setToast({ message: "Post dismissed.", undoPostId: postId });
      if (status === "handled") setToast({ message: "Marked as handled.", undoPostId: postId });
      refreshAll();
    },
  });
  const markRelevant = api.post.markRelevant.useMutation({ onSuccess: refreshAll });
  const actionError = readableError(updateStatus.error ?? markRelevant.error);

  const allPosts = data?.pages.flatMap((page) => page.posts) ?? [];

  if (isLoading) {
    return <FeedSkeleton />;
  }

  return (
    <div className="space-y-4 py-4">
      <FilterBar
        category={filters.category}
        minUrgency={filters.minUrgency}
        status={filters.status}
        relevance={filters.relevance}
        counts={{
          relevant: stats?.open,
          review: stats?.review,
          filtered: stats?.filtered,
          waiting: stats?.pending,
        }}
        postCount={allPosts.length}
        busy={isFetching && !isFetchingNextPage}
        onCategoryChange={(c) => setFilters((f) => ({ ...f, category: c }))}
        onUrgencyChange={(u) => setFilters((f) => ({ ...f, minUrgency: u }))}
        onStatusChange={(s) => setFilters((f) => ({ ...f, status: s }))}
        onRelevanceChange={(relevance) => setFilters((f) => ({ ...f, relevance }))}
      />

      {actionError && (
        <div role="alert" className="alert alert-error alert-soft">
          <span>{actionError}</span>
        </div>
      )}

      {isError && allPosts.length === 0 && (
        <div role="alert" className="alert alert-error alert-soft">
          <span>The feed could not load.</span>
          <button type="button" className="btn btn-sm" onClick={() => void refetch()}>
            Try again
          </button>
        </div>
      )}

      {!isError && allPosts.length === 0 && (
        <EmptyState
          title={
            filters.relevance === "filtered"
              ? "No filtered posts saved yet."
              : filters.relevance === "review"
                ? "Nothing needs your check."
              : filters.relevance === "waiting"
                ? "Nothing is waiting to be classified."
                : "No posts matching your filters."
          }
          message={
            isCollecting
              ? "A collection is running in the background. New posts will show up here."
              : filters.relevance === "relevant" && (stats?.review ?? 0) > 0
                ? `${stats?.review} ${stats?.review === 1 ? "post is" : "posts are"} waiting for your check. Open “Needs your check” to keep or reject them.`
                : filters.relevance === "relevant" && pending > 0
                  ? `${pending} saved posts are not classified yet. Choose “Not classified yet” or “All saved” to see them.`
                  : "Try adjusting the filters or wait for the next scheduled collection."
          }
        />
      )}

      <div
        className={`space-y-3 transition-opacity duration-300 ${
          isPlaceholderData ? "opacity-50" : "opacity-100"
        }`}
      >
        {allPosts.map((post) => (
          <PostCard
            key={post.id}
            post={{
              ...(post as PostData),
              isNew:
                newSince !== null &&
                post.classifiedAt !== null &&
                post.isRelevant === true &&
                new Date(post.classifiedAt) > newSince,
            }}
            onHandle={() =>
              updateStatus.mutate({ postId: post.id, status: "handled" })
            }
            onDismiss={() =>
              updateStatus.mutate({ postId: post.id, status: "dismissed" })
            }
            onReopen={() =>
              updateStatus.mutate({ postId: post.id, status: "new" })
            }
            onMarkRelevant={(reason) =>
              markRelevant.mutate({ postId: post.id, reason })
            }
            onOpen={() => setOpenPostId(post.id)}
            actionsDisabled={updateStatus.isPending || markRelevant.isPending}
          />
        ))}
      </div>

      {hasNextPage && (
        <div className="flex justify-center py-4">
          <button type="button" className="btn" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage && <span className="loading loading-spinner loading-xs" />}
            Load more
          </button>
        </div>
      )}

      {openPostId && (
        <PostDetail
          postId={openPostId}
          onSelectPost={setOpenPostId}
          onClose={() => setOpenPostId(null)}
          onHandle={(postId) => updateStatus.mutate({ postId, status: "handled" })}
          onDismiss={(postId) => updateStatus.mutate({ postId, status: "dismissed" })}
          onReopen={(postId) => updateStatus.mutate({ postId, status: "new" })}
          actionsDisabled={updateStatus.isPending}
        />
      )}

      {arrivals > 0 && (
        <div className="toast toast-top toast-center z-40">
          <button
            type="button"
            className="btn btn-primary btn-sm gap-1 rounded-full shadow-lg"
            onClick={() => {
              window.scrollTo({ top: 0, behavior: "smooth" });
              setArrivals(0);
            }}
          >
            <ArrowUp className="size-4" aria-hidden />
            {arrivals} new {arrivals === 1 ? "post" : "posts"}
          </button>
        </div>
      )}

      {toast && (
        <div className="toast toast-end z-40">
          <div role="status" className="alert shadow-lg">
            <span>{toast.message}</span>
            {toast.undoPostId && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  updateStatus.mutate({ postId: toast.undoPostId!, status: "new" });
                  setToast(null);
                }}
              >
                Undo
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
