import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { AppLayout } from "./AppLayout";

const meta = {
  title: "Templates/AppLayout",
  component: AppLayout,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AppLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    tabs: [
      { id: "dashboard", label: "Dashboard" },
      { id: "feed", label: "Feed" },
      { id: "settings", label: "Settings" },
    ],
    activeTab: "dashboard",
    onTabChange: () => undefined,
    title: "AutoLeap",
    sidebar: <div className="px-2 text-sm text-base-content/60">Sessions go here</div>,
    children: (
      <div className="rounded-box bg-base-100 p-8 text-center text-base-content/70">
        Page content
      </div>
    ),
  },
};
