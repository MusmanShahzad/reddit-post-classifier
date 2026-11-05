import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "@storybook/test";
import { RemovableTag } from "./RemovableTag";

const meta = {
  title: "Atoms/RemovableTag",
  component: RemovableTag,
  tags: ["autodocs"],
  args: { onRemove: fn() },
} satisfies Meta<typeof RemovableTag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: "Acme Corp" },
};

export const WithSublabel: Story = {
  args: { label: "Acme", sublabel: "(acme, ACME)" },
};

export const Secondary: Story = {
  args: { label: "DataBox", variant: "secondary" },
};

export const Outline: Story = {
  args: { label: "SaaS analytics", variant: "outline" },
};

export const TagGroup: Story = {
  args: { label: "Acme", onRemove: fn() },
  render: () => (
    <div className="flex flex-wrap gap-2">
      <RemovableTag label="Acme" sublabel="(acme, ACME)" onRemove={fn()} />
      <RemovableTag label="DataBox" variant="secondary" onRemove={fn()} />
      <RemovableTag label="analytics" variant="outline" onRemove={fn()} />
    </div>
  ),
};
