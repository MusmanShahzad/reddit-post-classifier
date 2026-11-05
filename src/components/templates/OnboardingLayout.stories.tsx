import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { OnboardingLayout } from "./OnboardingLayout";

const meta = {
  title: "Templates/OnboardingLayout",
  component: OnboardingLayout,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof OnboardingLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <div className="card card-border bg-base-100">
        <div className="card-body text-sm">Setup content goes here.</div>
      </div>
    ),
  },
};
