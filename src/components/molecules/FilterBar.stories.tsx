import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "@storybook/test";
import { FilterBar } from "./FilterBar";

const meta = {
  title: "Molecules/FilterBar",
  component: FilterBar,
  tags: ["autodocs"],
  args: {
    onCategoryChange: fn(),
    onUrgencyChange: fn(),
    onStatusChange: fn(),
  },
} satisfies Meta<typeof FilterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    status: "new",
    postCount: 42,
  },
};

export const WithFilters: Story = {
  args: {
    category: "complaint",
    minUrgency: 4,
    status: "new",
    postCount: 7,
  },
};

export const AllPosts: Story = {
  args: {
    status: "all",
    postCount: 128,
  },
};
