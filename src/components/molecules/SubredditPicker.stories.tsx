import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "@storybook/test";
import { SubredditPicker } from "./SubredditPicker";

const meta = {
  title: "Molecules/SubredditPicker",
  component: SubredditPicker,
  tags: ["autodocs"],
  args: {
    onToggle: fn(),
    onAddCustom: fn(),
  },
  decorators: [(Story) => <div className="w-[500px]"><Story /></div>],
} satisfies Meta<typeof SubredditPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    subreddits: [
      { name: "webdev", subscribers: 1_200_000, selected: true },
      { name: "programming", subscribers: 5_000_000, selected: true },
      { name: "SaaS", subscribers: 85_000, selected: false },
      { name: "startups", subscribers: 1_100_000, selected: true },
      { name: "datascience", subscribers: 900_000, selected: false },
      { name: "analytics", subscribers: 45_000, selected: true },
    ],
  },
};

export const Empty: Story = {
  args: { subreddits: [] },
};
