import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "@storybook/test";
import { ConfigReviewCard } from "./ConfigReviewCard";

const meta = {
  title: "Organisms/ConfigReviewCard",
  component: ConfigReviewCard,
  tags: ["autodocs"],
  args: {
    onToggleSubreddit: fn(),
    onAddSubreddit: fn(),
    onConfirm: fn(),
    onAddCompetitor: fn(),
    onRemoveCompetitor: fn(),
    onAddTopic: fn(),
    onRemoveTopic: fn(),
    isSaving: false,
  },
  decorators: [(Story) => <div className="w-[600px]"><Story /></div>],
} satisfies Meta<typeof ConfigReviewCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    config: {
      companyName: "Acme Corp",
      brandKeywords: [
        { value: "Acme Corp", aliases: ["acme", "ACME"] },
        { value: "Acme Analytics", aliases: [] },
      ],
      competitorKeywords: [{ value: "DataBox" }, { value: "Mixpanel" }],
      topicKeywords: [
        { value: "analytics dashboard" },
        { value: "data visualization" },
        { value: "business intelligence" },
      ],
    },
    subreddits: [
      { name: "webdev", subscribers: 1200000, selected: true },
      { name: "SaaS", subscribers: 85000, selected: true },
      { name: "datascience", subscribers: 900000, selected: false },
      { name: "startups", subscribers: 1100000, selected: true },
    ],
  },
};

export const Saving: Story = {
  args: {
    config: {
      companyName: "Acme Corp",
      brandKeywords: [{ value: "Acme", aliases: [] }],
      competitorKeywords: [{ value: "DataBox" }],
      topicKeywords: [{ value: "analytics" }],
    },
    subreddits: [{ name: "webdev", subscribers: 1200000, selected: true }],
    isSaving: true,
  },
};

export const NoSubreddits: Story = {
  args: {
    config: {
      companyName: "Acme Corp",
      brandKeywords: [{ value: "Acme", aliases: [] }],
      competitorKeywords: [],
      topicKeywords: [{ value: "analytics" }],
    },
    subreddits: [],
  },
};
