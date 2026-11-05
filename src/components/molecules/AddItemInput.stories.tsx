import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "@storybook/test";
import { AddItemInput } from "./AddItemInput";

const meta = {
  title: "Molecules/AddItemInput",
  component: AddItemInput,
  tags: ["autodocs"],
  args: { onAdd: fn() },
  decorators: [(Story) => <div className="w-[400px]"><Story /></div>],
} satisfies Meta<typeof AddItemInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { placeholder: "Add keyword..." },
};

export const Subreddit: Story = {
  args: {
    placeholder: "Add subreddit...",
    transform: (v: string) => v.replace(/^r\//, ""),
  },
};

export const Disabled: Story = {
  args: { placeholder: "Add keyword...", disabled: true },
};
