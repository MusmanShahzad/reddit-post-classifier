import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SentimentBadge } from "./SentimentBadge";
import { SENTIMENTS } from "@/lib/types";

const meta = {
  title: "Atoms/SentimentBadge",
  component: SentimentBadge,
  tags: ["autodocs"],
  argTypes: {
    sentiment: { control: "select", options: [...SENTIMENTS] },
  },
} satisfies Meta<typeof SentimentBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Positive: Story = { args: { sentiment: "positive" } };
export const Negative: Story = { args: { sentiment: "negative" } };
export const Neutral: Story = { args: { sentiment: "neutral" } };

export const AllSentiments: Story = {
  args: { sentiment: "neutral" },
  render: () => (
    <div className="flex gap-2">
      {SENTIMENTS.map((s) => (
        <SentimentBadge key={s} sentiment={s} />
      ))}
    </div>
  ),
};
