"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_EMOJI,
  SENTIMENT_EMOJI,
  SENTIMENT_LABELS,
  getUrgencyColor,
  getUrgencyLabel,
  timeAgo,
  type Category,
  type Sentiment,
} from "~/lib/types";

export function Feed() {
  const [filters, setFilters] = useState({
    category: undefined as string | undefined,
    sentiment: undefined as string | undefined,
    minUrgency: undefined as number | undefined,
    status: "new" as "new" | "handled" | "all",
  });

  const {
    data,
    refetch,
    isLoading,
    fetchNextPage,
    hasNextPage,
  } = api.post.getFeed.useInfiniteQuery(
    {
      ...filters,
      limit: 20,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    },
  );

  const updateStatus = api.post.updateStatus.useMutation({
    onSuccess: () => void refetch(),
  });

  const allPosts = data?.pages.flatMap((page) => page.posts) ?? [];

  return (
    <div className="space-y-4 py-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={filters.category ?? "all"}
          onValueChange={(v) => {
            const val = v ?? "all";
            setFilters((f) => ({
              ...f,
              category: val === "all" ? undefined : val,
            }));
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {CATEGORY_EMOJI[cat]} {CATEGORY_LABELS[cat]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.minUrgency?.toString() ?? "all"}
          onValueChange={(v) => {
            const val = v ?? "all";
            setFilters((f) => ({
              ...f,
              minUrgency: val === "all" ? undefined : Number(val),
            }));
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Urgency" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Urgency</SelectItem>
            <SelectItem value="5">🔴 Critical (5)</SelectItem>
            <SelectItem value="4">🟠 High (4+)</SelectItem>
            <SelectItem value="3">🟡 Medium (3+)</SelectItem>
            <SelectItem value="2">🔵 Low (2+)</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.status}
          onValueChange={(v) => {
            const val = (v ?? "new") as "new" | "handled" | "all";
            setFilters((f) => ({ ...f, status: val }));
          }}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new">📝 New</SelectItem>
            <SelectItem value="handled">✓ Handled</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-sm text-gray-500">
          {allPosts.length} posts
        </span>
      </div>

      {/* Post cards */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-red-500 border-t-transparent" />
        </div>
      )}

      {!isLoading && allPosts.length === 0 && (
        <Card className="p-8 text-center">
          <p className="text-lg text-gray-500">No posts matching your filters.</p>
          <p className="mt-1 text-sm text-gray-400">
            Try adjusting the filters or run a new collection.
          </p>
        </Card>
      )}

      <div className="space-y-3">
        {allPosts.map((post) => (
          <Card key={post.id} className="overflow-hidden">
            <div className="p-4">
              {/* Header row */}
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {post.urgency && (
                    <Badge className={getUrgencyColor(post.urgency)}>
                      {getUrgencyLabel(post.urgency)} ({post.urgency})
                    </Badge>
                  )}
                  <span className="text-xs text-gray-400">
                    r/{post.subreddit}
                  </span>
                  <span className="text-xs text-gray-400">•</span>
                  <span className="text-xs text-gray-400">
                    {timeAgo(post.redditCreatedAt)}
                  </span>
                  <span className="text-xs text-gray-400">•</span>
                  <span className="text-xs text-gray-400">
                    ⬆ {post.redditScore}
                  </span>
                  <span className="text-xs text-gray-400">
                    💬 {post.numComments}
                  </span>
                </div>
              </div>

              {/* Title */}
              <h3 className="mb-2 font-semibold text-gray-900">
                {post.title}
              </h3>

              {/* Body preview */}
              {post.body && (
                <p className="mb-3 line-clamp-2 text-sm text-gray-600">
                  {post.body}
                </p>
              )}

              {/* Tags */}
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {post.category && (
                  <Badge variant="outline">
                    {CATEGORY_EMOJI[post.category as Category]}{" "}
                    {CATEGORY_LABELS[post.category as Category] ?? post.category}
                  </Badge>
                )}
                {post.sentiment && (
                  <Badge variant="outline">
                    {SENTIMENT_EMOJI[post.sentiment as Sentiment]}{" "}
                    {SENTIMENT_LABELS[post.sentiment as Sentiment] ?? post.sentiment}
                  </Badge>
                )}
              </div>

              {/* Reason */}
              {post.reason && (
                <div className="mb-3 rounded-lg bg-yellow-50 p-2 text-sm text-yellow-800">
                  💡 {post.reason}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2">
                {post.status === "new" && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        updateStatus.mutate({
                          postId: post.id,
                          status: "handled",
                        })
                      }
                      disabled={updateStatus.isPending}
                    >
                      ✅ Mark Handled
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        updateStatus.mutate({
                          postId: post.id,
                          status: "dismissed",
                        })
                      }
                      disabled={updateStatus.isPending}
                      className="text-gray-500"
                    >
                      ❌ Dismiss
                    </Button>
                  </>
                )}
                {post.status === "handled" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      updateStatus.mutate({
                        postId: post.id,
                        status: "new",
                      })
                    }
                    disabled={updateStatus.isPending}
                    className="text-gray-500"
                  >
                    ↩ Reopen
                  </Button>
                )}
                <a
                  href={post.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto text-sm text-red-500 hover:text-red-600 hover:underline"
                >
                  🔗 Open on Reddit
                </a>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Load more */}
      {hasNextPage && (
        <div className="flex justify-center py-4">
          <Button
            variant="outline"
            onClick={() => void fetchNextPage()}
          >
            Load More
          </Button>
        </div>
      )}
    </div>
  );
}
