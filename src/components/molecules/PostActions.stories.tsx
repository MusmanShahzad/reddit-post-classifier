import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "@storybook/test";
import { PostActions } from "./PostActions";

const meta = {
  title: "Molecules/PostActions",
  component: PostActions,
  tags: ["autodocs"],
  args: {
    permalink: "https://reddit.com/r/webdev/comments/abc123/example",
    onHandle: fn(),
    onDismiss: fn(),
    onReopen: fn(),
  },
  decorators: [(Story) => <div className="w-[500px]"><Story /></div>],
} satisfies Meta<typeof PostActions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewPost: Story = {
  args: { status: "new" },
};

export const HandledPost: Story = {
  args: { status: "handled" },
};

export const Disabled: Story = {
  args: { status: "new", disabled: true },
};
