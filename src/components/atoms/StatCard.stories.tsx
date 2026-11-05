import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { StatCard } from "./StatCard";

const meta = {
  title: "Atoms/StatCard",
  component: StatCard,
  tags: ["autodocs"],
  argTypes: {
    color: { control: "text" },
  },
} satisfies Meta<typeof StatCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: "Total Posts", value: 128, icon: "📊" },
};

export const WithColor: Story = {
  args: { label: "Relevant", value: 42, icon: "✅", color: "text-green-600" },
};

export const Urgent: Story = {
  args: { label: "Urgent (4+)", value: 7, icon: "🔴", color: "text-red-600" },
};

export const Grid: Story = {
  args: { label: "Total Posts", value: 128, icon: "📊" },
  render: () => (
    <div className="grid grid-cols-3 gap-4">
      <StatCard label="Total Posts" value={128} icon="📊" />
      <StatCard label="Relevant" value={42} icon="✅" color="text-green-600" />
      <StatCard label="Filtered" value={86} icon="🚫" color="text-gray-400" />
      <StatCard label="Urgent (4+)" value={7} icon="🔴" color="text-red-600" />
      <StatCard label="Pending" value={12} icon="📝" color="text-blue-600" />
      <StatCard label="Handled" value={23} icon="✓" color="text-green-500" />
    </div>
  ),
};
