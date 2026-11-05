import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "@storybook/test";
import { CollectionStatusPanel } from "./CollectionStatusPanel";

const meta = {
  title: "Organisms/CollectionStatusPanel",
  component: CollectionStatusPanel,
  tags: ["autodocs"],
  args: { onRunCollection: fn() },
  decorators: [(Story) => <div className="w-[400px]"><Story /></div>],
} satisfies Meta<typeof CollectionStatusPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  args: {
    lastRun: {
      status: "completed",
      startedAt: new Date().toISOString(),
      totalFetched: 240,
      totalNew: 38,
      totalRelevant: 12,
    },
    isCollecting: false,
  },
};

export const Collecting: Story = {
  args: {
    lastRun: {
      status: "completed",
      startedAt: new Date().toISOString(),
      totalFetched: 240,
      totalNew: 38,
      totalRelevant: 12,
    },
    isCollecting: true,
  },
};

export const NoLastRun: Story = {
  args: { lastRun: null, isCollecting: false },
};

export const FailedRun: Story = {
  args: {
    lastRun: {
      status: "failed",
      startedAt: new Date().toISOString(),
      totalFetched: 100,
      totalNew: 0,
      totalRelevant: 0,
    },
    isCollecting: false,
  },
};
