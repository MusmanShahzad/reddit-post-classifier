import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "@storybook/test";
import { TagList } from "./TagList";

const meta = {
  title: "Molecules/TagList",
  component: TagList,
  tags: ["autodocs"],
} satisfies Meta<typeof TagList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const BrandKeywords: Story = {
  args: {
    tags: [
      { label: "Acme Corp", sublabel: "(acme, ACME)", onRemove: fn() },
      { label: "Acme Analytics", onRemove: fn() },
    ],
  },
};

export const Competitors: Story = {
  args: {
    tags: [
      { label: "DataBox", variant: "secondary", onRemove: fn() },
      { label: "Mixpanel", variant: "secondary", onRemove: fn() },
      { label: "Amplitude", variant: "secondary", onRemove: fn() },
    ],
  },
};

export const Topics: Story = {
  args: {
    tags: [
      { label: "analytics dashboard", variant: "outline", onRemove: fn() },
      { label: "data visualization", variant: "outline", onRemove: fn() },
      { label: "business intelligence", variant: "outline", onRemove: fn() },
    ],
  },
};

export const Empty: Story = {
  args: { tags: [] },
};
