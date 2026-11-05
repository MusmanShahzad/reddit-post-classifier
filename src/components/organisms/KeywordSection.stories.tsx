import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "@storybook/test";
import { KeywordSection } from "./KeywordSection";

const meta = {
  title: "Organisms/KeywordSection",
  component: KeywordSection,
  tags: ["autodocs"],
  args: {
    onDeleteKeyword: fn(),
    onAddKeyword: fn(),
  },
  decorators: [(Story) => <div className="w-[600px]"><Story /></div>],
} satisfies Meta<typeof KeywordSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    brands: [
      { id: "1", value: "Acme Corp", aliases: '["acme", "ACME"]' },
      { id: "2", value: "Acme Analytics", aliases: "[]" },
    ],
    competitors: [
      { id: "3", value: "DataBox", aliases: "[]" },
      { id: "4", value: "Mixpanel", aliases: "[]" },
    ],
    topics: [
      { id: "5", value: "analytics dashboard", aliases: "[]" },
      { id: "6", value: "data visualization", aliases: "[]" },
    ],
  },
};

export const Empty: Story = {
  args: { brands: [], competitors: [], topics: [] },
};
