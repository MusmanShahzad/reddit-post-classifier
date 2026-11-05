import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { PipelineStatus } from "./PipelineStatus";

const meta = {
  title: "Atoms/PipelineStatus",
  component: PipelineStatus,
  tags: ["autodocs"],
  decorators: [(Story) => <div className="w-[400px]"><Story /></div>],
} satisfies Meta<typeof PipelineStatus>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllPending: Story = {
  args: {
    steps: [
      { id: "validation", label: "Input validation", status: "pending" },
      { id: "moderation", label: "Content safety check", status: "pending" },
      { id: "guardrails", label: "Business focus check", status: "pending" },
      { id: "extraction", label: "Extracting config", status: "pending" },
    ],
  },
};

export const ModerationRunning: Story = {
  args: {
    steps: [
      { id: "validation", label: "Input validation", status: "done" },
      { id: "moderation", label: "Content safety check", status: "running" },
      { id: "guardrails", label: "Business focus check", status: "pending" },
      { id: "extraction", label: "Extracting config", status: "pending" },
    ],
  },
};

export const ExtractionRunning: Story = {
  args: {
    steps: [
      { id: "validation", label: "Input validation", status: "done" },
      { id: "moderation", label: "Content safety check", status: "done", detail: "Passed" },
      { id: "guardrails", label: "Business focus check", status: "done", detail: "Business confirmed" },
      { id: "extraction", label: "Extracting config", status: "running" },
    ],
  },
};

export const AllDone: Story = {
  args: {
    steps: [
      { id: "validation", label: "Input validation", status: "done" },
      { id: "moderation", label: "Content safety check", status: "done", detail: "Passed" },
      { id: "guardrails", label: "Business focus check", status: "done", detail: "Business confirmed" },
      { id: "extraction", label: "Extracting config", status: "done", detail: "Config extracted" },
    ],
  },
};

export const ModerationFlagged: Story = {
  args: {
    steps: [
      { id: "validation", label: "Input validation", status: "done" },
      { id: "moderation", label: "Content safety check", status: "error", detail: "Flagged" },
      { id: "guardrails", label: "Business focus check", status: "skipped" },
      { id: "extraction", label: "Extracting config", status: "skipped" },
    ],
  },
};

export const ExtractionError: Story = {
  args: {
    steps: [
      { id: "validation", label: "Input validation", status: "done" },
      { id: "moderation", label: "Content safety check", status: "done", detail: "Passed" },
      { id: "guardrails", label: "Business focus check", status: "done", detail: "Passed" },
      { id: "extraction", label: "Extracting config", status: "error", detail: "Invalid AI response" },
    ],
  },
};

export const SavingConfig: Story = {
  args: {
    steps: [
      { id: "saving", label: "Saving configuration", status: "running" },
      { id: "queries", label: "Generating search queries", status: "pending" },
    ],
  },
};
