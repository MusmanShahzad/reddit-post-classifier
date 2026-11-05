import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CategoryBreakdown } from "./CategoryBreakdown";

const meta = {
  title: "Organisms/CategoryBreakdown",
  component: CategoryBreakdown,
  tags: ["autodocs"],
  decorators: [(Story) => <div className="w-[500px]"><Story /></div>],
} satisfies Meta<typeof CategoryBreakdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    totalRelevant: 50,
    categories: [
      { category: "complaint", count: 18 },
      { category: "praise", count: 12 },
      { category: "product_idea", count: 8 },
      { category: "bug_report", count: 6 },
      { category: "recommendation_ask", count: 4 },
      { category: "other", count: 2 },
    ],
  },
};

export const Empty: Story = {
  args: { totalRelevant: 0, categories: [] },
};

export const SingleCategory: Story = {
  args: {
    totalRelevant: 15,
    categories: [{ category: "complaint", count: 15 }],
  },
};
