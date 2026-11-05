import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import {
  StatCardSkeleton,
  PostCardSkeleton,
  CategoryBreakdownSkeleton,
  CollectionStatusSkeleton,
  ActivityLogSkeleton,
  KeywordSectionSkeleton,
  SubredditSectionSkeleton,
  SearchQuerySectionSkeleton,
  AppLoadingSkeleton,
  DashboardSkeleton,
  FeedSkeleton,
  SettingsSkeleton,
} from "./Skeleton";

// Use a simple wrapper component for autodocs since skeletons have no props
const SkeletonShowcase = () => <StatCardSkeleton />;

const meta = {
  title: "Atoms/Skeletons",
  component: SkeletonShowcase,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof SkeletonShowcase>;

export default meta;
type Story = StoryObj<typeof meta>;

// ---------------------------------------------------------------------------
// Individual component skeletons
// ---------------------------------------------------------------------------

export const StatCard: Story = {
  args: {},
  render: () => (
    <div className="max-w-xs">
      <StatCardSkeleton />
    </div>
  ),
};

export const StatCardGrid: Story = {
  args: {},
  render: () => (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </div>
  ),
};

export const PostCard: Story = {
  args: {},
  render: () => (
    <div className="max-w-2xl">
      <PostCardSkeleton />
    </div>
  ),
};

export const PostCardList: Story = {
  args: {},
  render: () => (
    <div className="max-w-2xl space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <PostCardSkeleton key={i} />
      ))}
    </div>
  ),
};

export const CategoryBreakdown: Story = {
  args: {},
  render: () => (
    <div className="max-w-lg">
      <CategoryBreakdownSkeleton />
    </div>
  ),
};

export const CollectionStatus: Story = {
  args: {},
  render: () => (
    <div className="max-w-lg">
      <CollectionStatusSkeleton />
    </div>
  ),
};

export const ActivityLog: Story = {
  args: {},
  render: () => (
    <div className="max-w-2xl">
      <ActivityLogSkeleton />
    </div>
  ),
};

export const KeywordSection: Story = {
  args: {},
  render: () => (
    <div className="max-w-2xl">
      <KeywordSectionSkeleton />
    </div>
  ),
};

export const SubredditSection: Story = {
  args: {},
  render: () => (
    <div className="max-w-2xl">
      <SubredditSectionSkeleton />
    </div>
  ),
};

export const SearchQuerySection: Story = {
  args: {},
  render: () => (
    <div className="max-w-2xl">
      <SearchQuerySectionSkeleton />
    </div>
  ),
};

// ---------------------------------------------------------------------------
// Full page skeletons
// ---------------------------------------------------------------------------

export const AppLoading: Story = {
  args: {},
  parameters: { layout: "fullscreen" },
  render: () => <AppLoadingSkeleton />,
};

export const DashboardPage: Story = {
  args: {},
  render: () => (
    <div className="mx-auto max-w-6xl px-4">
      <DashboardSkeleton />
    </div>
  ),
};

export const FeedPage: Story = {
  args: {},
  render: () => (
    <div className="mx-auto max-w-3xl px-4">
      <FeedSkeleton />
    </div>
  ),
};

export const SettingsPage: Story = {
  args: {},
  render: () => (
    <div className="mx-auto max-w-3xl px-4">
      <SettingsSkeleton />
    </div>
  ),
};
