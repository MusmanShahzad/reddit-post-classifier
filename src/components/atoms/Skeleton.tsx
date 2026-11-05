import { Skeleton as SkeletonPrimitive } from "@/components/ui/skeleton";

// ---------------------------------------------------------------------------
// StatCard Skeleton
// ---------------------------------------------------------------------------

/**
 * Shimmer placeholder matching the StatCard layout.
 *
 * Shows a pulsing icon circle + text line on top and a large number block below.
 *
 * @example
 * ```tsx
 * {isLoading ? <StatCardSkeleton /> : <StatCard ... />}
 * ```
 */
export function StatCardSkeleton() {
  return (
    <div className="stats w-full bg-base-100 shadow-sm">
      <div className="stat">
        <SkeletonPrimitive className="h-4 w-24" />
        <SkeletonPrimitive className="mt-2 h-8 w-12" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PostCard Skeleton
// ---------------------------------------------------------------------------

/**
 * Shimmer placeholder matching the PostCard layout.
 *
 * Mimics the urgency badge, metadata line, title, body preview, tag row,
 * reason box, and action buttons.
 *
 * @example
 * ```tsx
 * {isLoading
 *   ? Array.from({ length: 3 }).map((_, i) => <PostCardSkeleton key={i} />)
 *   : posts.map(p => <PostCard key={p.id} ... />)}
 * ```
 */
export function PostCardSkeleton() {
  return (
    <div className="card card-border bg-base-100"><div className="card-body">
      <div className="p-4">
        {/* Header row */}
        <div className="mb-3 flex items-center gap-2">
          <SkeletonPrimitive className="h-5 w-20 rounded-full" />
          <SkeletonPrimitive className="h-3 w-14" />
          <SkeletonPrimitive className="h-3 w-10" />
          <SkeletonPrimitive className="h-3 w-8" />
        </div>
        {/* Title */}
        <SkeletonPrimitive className="mb-2 h-5 w-3/4" />
        {/* Body preview */}
        <SkeletonPrimitive className="mb-1 h-3.5 w-full" />
        <SkeletonPrimitive className="mb-3 h-3.5 w-2/3" />
        {/* Tags */}
        <div className="mb-3 flex gap-2">
          <SkeletonPrimitive className="h-5 w-24 rounded-full" />
          <SkeletonPrimitive className="h-5 w-20 rounded-full" />
        </div>
        {/* Reason */}
        <SkeletonPrimitive className="mb-3 h-10 w-full rounded-lg" />
        {/* Actions */}
        <div className="flex items-center gap-2">
          <SkeletonPrimitive className="h-8 w-28 rounded-md" />
          <SkeletonPrimitive className="h-8 w-20 rounded-md" />
          <SkeletonPrimitive className="ml-auto h-4 w-24" />
        </div>
      </div>
    </div></div>
  );
}

// ---------------------------------------------------------------------------
// CategoryBreakdown Skeleton
// ---------------------------------------------------------------------------

/**
 * Shimmer placeholder matching the CategoryBreakdown chart card.
 *
 * Shows a title shimmer and 4 category row placeholders with bars.
 */
export function CategoryBreakdownSkeleton() {
  return (
    <div className="card card-border bg-base-100"><div className="card-body">
      <SkeletonPrimitive className="mb-5 h-4 w-36" />
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <SkeletonPrimitive className="h-5 w-5 rounded-full" />
            <SkeletonPrimitive className="h-3.5 w-24" />
            <div className="flex-1">
              <SkeletonPrimitive className="h-3 w-full rounded-full" />
            </div>
            <SkeletonPrimitive className="h-3.5 w-8" />
          </div>
        ))}
      </div>
    </div></div>
  );
}

// ---------------------------------------------------------------------------
// CollectionStatus Skeleton
// ---------------------------------------------------------------------------

/**
 * Shimmer placeholder for the Collection Status panel.
 *
 * Mimics the title row with badge, stats grid, and action button.
 */
export function CollectionStatusSkeleton() {
  return (
    <div className="card card-border bg-base-100"><div className="card-body">
      <div className="mb-4 flex items-center justify-between">
        <SkeletonPrimitive className="h-4 w-28" />
        <SkeletonPrimitive className="h-5 w-16 rounded-full" />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonPrimitive key={i} className="h-4 w-full" />
        ))}
      </div>
      <SkeletonPrimitive className="h-10 w-full rounded-md" />
    </div></div>
  );
}

// ---------------------------------------------------------------------------
// ActivityLog Skeleton
// ---------------------------------------------------------------------------

/**
 * Shimmer placeholder for the Activity Log card.
 *
 * Shows a title and 5 log-entry shimmer rows.
 */
export function ActivityLogSkeleton() {
  return (
    <div className="card card-border bg-base-100"><div className="card-body">
      <SkeletonPrimitive className="mb-5 h-4 w-32" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-start gap-2">
            <SkeletonPrimitive className="mt-0.5 h-3 w-16" />
            <SkeletonPrimitive className="h-4 w-14 rounded-full" />
            <SkeletonPrimitive className="h-3.5 w-48" />
          </div>
        ))}
      </div>
    </div></div>
  );
}

// ---------------------------------------------------------------------------
// KeywordSection Skeleton
// ---------------------------------------------------------------------------

/**
 * Shimmer placeholder for the Keyword management card in Settings.
 *
 * Shows 3 sub-section titles with tag groups and an add input.
 */
export function KeywordSectionSkeleton() {
  return (
    <div className="card card-border bg-base-100"><div className="card-body">
      {/* Brand section */}
      <SkeletonPrimitive className="mb-4 h-4 w-28" />
      <div className="mb-4 flex flex-wrap gap-2">
        <SkeletonPrimitive className="h-5 w-20 rounded-full" />
        <SkeletonPrimitive className="h-5 w-28 rounded-full" />
        <SkeletonPrimitive className="h-5 w-16 rounded-full" />
      </div>
      <SkeletonPrimitive className="mb-4 h-px w-full" />
      {/* Competitors section */}
      <SkeletonPrimitive className="mb-4 h-4 w-24" />
      <div className="mb-4 flex flex-wrap gap-2">
        <SkeletonPrimitive className="h-5 w-24 rounded-full" />
        <SkeletonPrimitive className="h-5 w-20 rounded-full" />
      </div>
      <SkeletonPrimitive className="mb-4 h-px w-full" />
      {/* Topics section */}
      <SkeletonPrimitive className="mb-4 h-4 w-20" />
      <div className="mb-4 flex flex-wrap gap-2">
        <SkeletonPrimitive className="h-5 w-32 rounded-full" />
        <SkeletonPrimitive className="h-5 w-28 rounded-full" />
      </div>
      <SkeletonPrimitive className="mb-4 h-px w-full" />
      {/* Add input */}
      <div className="flex gap-2">
        <SkeletonPrimitive className="h-9 w-24 rounded-md" />
        <SkeletonPrimitive className="h-9 flex-1 rounded-md" />
        <SkeletonPrimitive className="h-9 w-14 rounded-md" />
      </div>
    </div></div>
  );
}

// ---------------------------------------------------------------------------
// SubredditSection Skeleton
// ---------------------------------------------------------------------------

/**
 * Shimmer placeholder for the Subreddit management card.
 */
export function SubredditSectionSkeleton() {
  return (
    <div className="card card-border bg-base-100"><div className="card-body">
      <SkeletonPrimitive className="mb-4 h-4 w-24" />
      <div className="mb-3 flex flex-wrap gap-2">
        <SkeletonPrimitive className="h-5 w-20 rounded-full" />
        <SkeletonPrimitive className="h-5 w-24 rounded-full" />
        <SkeletonPrimitive className="h-5 w-18 rounded-full" />
        <SkeletonPrimitive className="h-5 w-28 rounded-full" />
      </div>
      <div className="flex gap-2">
        <SkeletonPrimitive className="h-9 flex-1 rounded-md" />
        <SkeletonPrimitive className="h-9 w-14 rounded-md" />
      </div>
    </div></div>
  );
}

// ---------------------------------------------------------------------------
// SearchQuerySection Skeleton
// ---------------------------------------------------------------------------

/**
 * Shimmer placeholder for the Search Query management card.
 */
export function SearchQuerySectionSkeleton() {
  return (
    <div className="card card-border bg-base-100"><div className="card-body">
      <SkeletonPrimitive className="mb-4 h-4 w-24" />
      <div className="mb-3 space-y-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonPrimitive key={i} className="h-9 w-full rounded-lg" />
        ))}
      </div>
      <SkeletonPrimitive className="mb-2 h-3 w-64" />
      <div className="flex gap-2">
        <SkeletonPrimitive className="h-9 flex-1 rounded-md" />
        <SkeletonPrimitive className="h-9 w-14 rounded-md" />
      </div>
    </div></div>
  );
}

// ---------------------------------------------------------------------------
// Full-page app skeleton (initial load)
// ---------------------------------------------------------------------------

/**
 * Full-page skeleton shown while the app determines onboarding status.
 *
 * Renders the Radarr logo shimmer, a pulsing brand bar, and fading
 * placeholder text — much more polished than a bare spinner.
 */
export function AppLoadingSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-base-200">
      <div className="flex flex-col items-center gap-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral text-2xl font-bold text-neutral-content">
          R
        </div>
        <div className="text-center">
          <h1 className="text-xl font-bold">Radarr</h1>
          <p className="mt-1 text-sm text-base-content/60">Loading your dashboard…</p>
        </div>
        <span className="loading loading-dots loading-md" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard Skeleton (combines stat + chart + status + activity)
// ---------------------------------------------------------------------------

/**
 * Full Dashboard page skeleton shown while stats, lastRun, and activity load.
 */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6 py-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <CategoryBreakdownSkeleton />
        <CollectionStatusSkeleton />
      </div>
      <ActivityLogSkeleton />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feed Skeleton (filter bar + post cards)
// ---------------------------------------------------------------------------

/**
 * Full Feed page skeleton shown while the first page of posts loads.
 */
export function FeedSkeleton() {
  return (
    <div className="space-y-4 py-4">
      {/* Filter bar skeleton */}
      <div className="flex flex-wrap items-center gap-3">
        <SkeletonPrimitive className="h-9 w-[180px] rounded-md" />
        <SkeletonPrimitive className="h-9 w-[160px] rounded-md" />
        <SkeletonPrimitive className="h-9 w-[140px] rounded-md" />
        <SkeletonPrimitive className="h-4 w-16" />
      </div>
      {/* Post card skeletons */}
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <PostCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings Skeleton
// ---------------------------------------------------------------------------

/**
 * Full Settings page skeleton shown while company data loads.
 */
export function SettingsSkeleton() {
  return (
    <div className="space-y-6 py-4">
      <div>
        <SkeletonPrimitive className="h-6 w-24" />
        <SkeletonPrimitive className="mt-2 h-4 w-64" />
      </div>
      <KeywordSectionSkeleton />
      <SubredditSectionSkeleton />
      <SearchQuerySectionSkeleton />
    </div>
  );
}
