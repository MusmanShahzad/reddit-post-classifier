import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "@storybook/test";
import { SubredditSection } from "./SubredditSection";

const meta = {
  title: "Organisms/SubredditSection",
  component: SubredditSection,
  tags: ["autodocs"],
  args: {
    onRemove: fn(),
    onAdd: fn(),
  },
  decorators: [(Story) => <div className="w-[600px]"><Story /></div>],
} satisfies Meta<typeof SubredditSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    subreddits: [
      { id: "1", name: "webdev" },
      { id: "2", name: "SaaS" },
      { id: "3", name: "startups" },
      { id: "4", name: "datascience" },
    ],
  },
};

export const Empty: Story = {
  args: { subreddits: [] },
};
