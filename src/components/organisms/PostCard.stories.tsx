import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "@storybook/test";
import { PostCard } from "./PostCard";

const meta = {
  title: "Organisms/PostCard",
  component: PostCard,
  tags: ["autodocs"],
  args: {
    onHandle: fn(),
    onDismiss: fn(),
    onReopen: fn(),
  },
  decorators: [(Story) => <div className="w-[700px]"><Story /></div>],
} satisfies Meta<typeof PostCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const basePost = {
  id: "1",
  subreddit: "SaaS",
  permalink: "https://reddit.com/r/SaaS/comments/abc/test",
  redditScore: 42,
  numComments: 15,
  redditCreatedAt: new Date(Date.now() - 3600000),
};

export const NewComplaint: Story = {
  args: {
    post: {
      ...basePost,
      title: "Acme Analytics dashboard keeps crashing on large datasets",
      body: "Every time I try to load more than 10k rows, the dashboard freezes and I have to refresh the page. This has been happening for two weeks now. Anyone else experiencing this?",
      status: "new",
      urgency: 4,
      category: "complaint",
      sentiment: "negative",
      reason: "Existing customer cannot load large datasets and may leave — reply with a fix today.",
      audienceTag: "customer",
    },
  },
};

export const NewPraise: Story = {
  args: {
    post: {
      ...basePost,
      title: "Just switched to Acme and wow, the UX is incredible",
      body: "Coming from DataBox, this is night and day. The onboarding flow was smooth and the charts load instantly. Highly recommend!",
      status: "new",
      urgency: 2,
      category: "praise",
      sentiment: "positive",
      reason: "New customer who just switched from a rival — ask if you can quote them.",
      audienceTag: "customer",
    },
  },
};

export const HandledPost: Story = {
  args: {
    post: {
      ...basePost,
      title: "Feature request: dark mode for Acme dashboard",
      body: "Would love a dark mode option. The white background is too bright for late-night analytics sessions.",
      status: "handled",
      urgency: 2,
      category: "product_idea",
      sentiment: "neutral",
      reason: "Existing customer wants dark mode for late-night use — note it and reply.",
      audienceTag: "customer",
    },
  },
};

export const MinimalPost: Story = {
  args: {
    post: {
      ...basePost,
      title: "Has anyone tried Acme Analytics?",
      body: "",
      status: "new",
      urgency: 1,
      category: "recommendation_ask",
      sentiment: "neutral",
      reason: null,
      audienceTag: "potential_customer",
    },
  },
};
