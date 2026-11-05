import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ActivityLog } from "./ActivityLog";

const meta = {
  title: "Organisms/ActivityLog",
  component: ActivityLog,
  tags: ["autodocs"],
  decorators: [(Story) => <div className="w-[600px]"><Story /></div>],
} satisfies Meta<typeof ActivityLog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RecentActivity: Story = {
  args: {
    isCollecting: false,
    liveEvents: [],
    activity: [
      { id: "1", type: "fetch", message: "Fetched 240 raw, 180 unique, 38 new", timestamp: new Date() },
      { id: "2", type: "classify", message: "Classified 38: 12 relevant, 26 filtered", timestamp: new Date() },
      { id: "3", type: "summarize", message: "Generated 12 summaries", timestamp: new Date() },
    ],
  },
};

export const LiveCollection: Story = {
  args: {
    isCollecting: true,
    liveEvents: [
      { type: "started", message: "Collection started for Acme Corp" },
      { type: "fetching", message: 'Searching Reddit: "Acme Corp"' },
      { type: "fetched", message: 'Found 45 posts for "Acme Corp"' },
      { type: "classifying", message: 'Classifying 1/38: "Dashboard crash report..."' },
      { type: "classified", message: '✓ complaint — "Dashboard crash report..."' },
    ],
    activity: [],
  },
};

export const Empty: Story = {
  args: {
    isCollecting: false,
    liveEvents: [],
    activity: [],
  },
};
