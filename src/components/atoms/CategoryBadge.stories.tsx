import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CategoryBadge } from "./CategoryBadge";
import { CATEGORIES } from "@/lib/types";

const meta = {
  title: "Atoms/CategoryBadge",
  component: CategoryBadge,
  tags: ["autodocs"],
  argTypes: {
    category: { control: "select", options: [...CATEGORIES] },
  },
} satisfies Meta<typeof CategoryBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Complaint: Story = { args: { category: "complaint" } };
export const BugReport: Story = { args: { category: "bug_report" } };
export const ProductIdea: Story = { args: { category: "product_idea" } };
export const Praise: Story = { args: { category: "praise" } };
export const Recommendation: Story = { args: { category: "recommendation_ask" } };
export const Other: Story = { args: { category: "other" } };

export const AllCategories: Story = {
  args: { category: "complaint" },
  render: () => (
    <div className="flex flex-wrap gap-2">
      {CATEGORIES.map((cat) => (
        <CategoryBadge key={cat} category={cat} />
      ))}
    </div>
  ),
};
