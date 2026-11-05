import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { EmptyState } from "./EmptyState";

const meta = {
  title: "Atoms/EmptyState",
  component: EmptyState,
  tags: ["autodocs"],
  decorators: [(Story) => <div className="w-[600px]"><Story /></div>],
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { title: "No posts matching your filters." },
};

export const WithMessage: Story = {
  args: {
    title: "No posts matching your filters.",
    message: "Try adjusting the filters or run a new collection.",
  },
};

export const NoActivity: Story = {
  args: {
    title: "No activity yet.",
    message: 'Click "Run Collection Now" to start.',
  },
};
