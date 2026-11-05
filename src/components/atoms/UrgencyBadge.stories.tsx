import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { UrgencyBadge } from "./UrgencyBadge";

const meta = {
  title: "Atoms/UrgencyBadge",
  component: UrgencyBadge,
  tags: ["autodocs"],
  argTypes: {
    urgency: { control: { type: "range", min: 1, max: 5 } },
  },
} satisfies Meta<typeof UrgencyBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Critical: Story = { args: { urgency: 5 } };
export const High: Story = { args: { urgency: 4 } };
export const Medium: Story = { args: { urgency: 3 } };
export const Low: Story = { args: { urgency: 2 } };
export const None: Story = { args: { urgency: 1 } };

export const AllLevels: Story = {
  args: { urgency: 3 },
  render: () => (
    <div className="flex gap-2">
      {[5, 4, 3, 2, 1].map((u) => (
        <UrgencyBadge key={u} urgency={u} />
      ))}
    </div>
  ),
};
