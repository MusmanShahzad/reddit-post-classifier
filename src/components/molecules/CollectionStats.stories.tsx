import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CollectionStats } from "./CollectionStats";

const meta = {
  title: "Molecules/CollectionStats",
  component: CollectionStats,
  tags: ["autodocs"],
  decorators: [(Story) => <div className="w-[300px]"><Story /></div>],
} satisfies Meta<typeof CollectionStats>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    startedAt: new Date().toISOString(),
    totalFetched: 240,
    totalNew: 38,
    totalRelevant: 12,
  },
};

export const LargeRun: Story = {
  args: {
    startedAt: "2024-03-15T10:30:00Z",
    totalFetched: 1200,
    totalNew: 450,
    totalRelevant: 87,
  },
};
