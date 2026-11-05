"use client";

import { useRef, useState } from "react";
import { api } from "@/trpc/react";
import { ThinkingTrace, type PipelineStep, type TraceNote } from "@/components/atoms";
import {
  BriefExtrasModal,
  QuestionModal,
  SessionStartModal,
  type BriefExtras,
  type SessionStart,
  type SubredditEntry,
} from "@/components/molecules";
import { ConfigReviewCard } from "@/components/organisms";
import { OnboardingLayout } from "@/components/templates";
import { packHistory } from "@/lib/chat-context";
import { chatSummary } from "@/lib/relevance";
import { streamTurn } from "@/lib/turn-stream";

interface Config {
  companyName: string;
  product: string;
  buyer: string;
  keepWhen: string;
  notAbout: string;
  brandKeywords: Array<{ value: string; aliases: string[]; ambiguous?: boolean }>;
  competitorKeywords: Array<{ value: string; aliases?: string[]; ambiguous?: boolean }>;
  topicKeywords: Array<{ value: string }>;
  focusAreas?: string[];
}

/** start: the form. extras: the optional answers. question: one answer is unclear. review: ready to confirm. */
type Stage = "start" | "extras" | "working" | "question" | "review" | "failed";

function upsertStep(steps: PipelineStep[], step: PipelineStep): PipelineStep[] {
  const index = steps.findIndex((s) => s.id === step.id);
  if (index === -1) return [...steps, step];
  const next = [...steps];
  next[index] = step;
  return next;
}

/** The step a line of activity belongs to: the last one that has started. */
function latestStarted(steps: PipelineStep[]): string | undefined {
  return steps.filter((s) => s.status !== "pending" && s.status !== "skipped").at(-1)?.id;
}

type Turn = { role: "user" | "assistant"; content: string };

export interface SessionSetupProps {
  /** Rendered inside the app shell as a new session. */
  embedded?: boolean;
  onCancel?: () => void;
  onDone?: () => void;
}

/**
 * Sets up a session without a chat. A form collects the company, what it
 * sells, and what to find. A question appears in a modal only when one of
 * those is still unclear. Competitors, topics, and subreddits are filled in
 * for the user, who can change them on the review card before saving.
 */
export function SessionSetup({ embedded = false, onCancel, onDone }: SessionSetupProps = {}) {
  const [draftId] = useState(() => crypto.randomUUID());
  const [stage, setStage] = useState<Stage>("start");
  const [question, setQuestion] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [subreddits, setSubreddits] = useState<SubredditEntry[]>([]);
  const [steps, setSteps] = useState<PipelineStep[]>([]);
  const [activity, setActivity] = useState<TraceNote[]>([]);
  const [saveSteps, setSaveSteps] = useState<PipelineStep[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const knownRef = useRef<Config | null>(null);
  const summaryRef = useRef("");
  const historyRef = useRef<Turn[]>([]);
  const lastMessageRef = useRef("");
  const utils = api.useUtils();

  const saveConfig = api.onboarding.saveConfig.useMutation();
  const suggestSubs = api.onboarding.suggestSubreddits.useMutation();

  /** Sends the details to the assistant. It either finishes the setup or asks one question. */
  const run = async (message: string) => {
    lastMessageRef.current = message;
    setStage("working");
    setFailure(null);
    setSteps([]);
    setActivity([]);

    let live: PipelineStep[] = [];
    const packed = packHistory(historyRef.current, summaryRef.current);

    try {
      const result = await streamTurn(
        {
          message,
          conversationHistory: packed.history,
          draftId,
          summary: packed.summary,
          known: knownRef.current ?? undefined,
        },
        (event) => {
          if (event.type === "step") {
            live = upsertStep(live, event.step);
            setSteps(live);
          } else if (event.type === "activity") {
            const note = { stepId: latestStarted(live), text: event.text };
            setActivity((prev) => [...prev, note]);
          }
        },
      );

      historyRef.current = [
        ...historyRef.current,
        { role: "user", content: message },
        { role: "assistant", content: result.reply },
      ];
      if (result.summary) summaryRef.current = result.summary;

      const cfg = result.config as Config | null;
      if (cfg) {
        knownRef.current = cfg;
        setConfig(cfg);
      }

      const ready = (result.phase === "confirming" || result.phase === "complete") && cfg;
      if (!ready) {
        setQuestion(result.reply);
        setStage("question");
        return;
      }

      live = upsertStep(result.pipelineSteps, { id: "subreddits", label: "Finding subreddits", status: "running" });
      setSteps(live);
      setActivity((prev) => [
        ...prev,
        { stepId: "subreddits", text: "Looking for subreddits where these conversations happen" },
      ]);

      let found = 0;
      try {
        const suggested = await suggestSubs.mutateAsync({
          topics: [...cfg.topicKeywords.map((t) => t.value), cfg.companyName],
          product: cfg.product,
        });
        found = suggested.length;
        setSubreddits(suggested.map((s) => ({ name: s.name, subscribers: s.subscribers, selected: true })));
      } catch {
        console.warn("Subreddit suggestion failed");
      }
      setSteps(
        upsertStep(live, {
          id: "subreddits",
          label: "Finding subreddits",
          status: found > 0 ? "done" : "error",
          detail: found > 0 ? `${found} found` : "None found, add your own",
        }),
      );
      setStage("review");
    } catch (error) {
      setFailure(
        error instanceof Error && error.message
          ? error.message
          : "Something went wrong while setting this up.",
      );
      setStage("failed");
    }
  };

  const handleSave = async (cfg: Config) => {
    setSaveError(null);
    setSaveSteps([
      { id: "saving", label: "Saving the session", status: "running" },
      { id: "queries", label: "Building search queries", status: "pending" },
    ]);

    try {
      await saveConfig.mutateAsync({
        draftId,
        companyName: cfg.companyName,
        product: cfg.product,
        buyer: cfg.buyer,
        keepWhen: cfg.keepWhen,
        notAbout: cfg.notAbout,
        brandKeywords: cfg.brandKeywords,
        competitorKeywords: cfg.competitorKeywords,
        topicKeywords: cfg.topicKeywords,
        subreddits: subreddits.filter((s) => s.selected).map((s) => s.name),
      });

      setSaveSteps([
        { id: "saving", label: "Saving the session", status: "done" },
        { id: "queries", label: "Building search queries", status: "done" },
      ]);
      await new Promise((r) => setTimeout(r, 600));
      setSaveSteps([]);
      await utils.invalidate();
      onDone?.();
    } catch {
      setSaveSteps([]);
      setSaveError("I couldn't save the session. Please try again.");
    }
  };

  const toggleSubreddit = (name: string) => {
    setSubreddits((prev) => prev.map((s) => (s.name === name ? { ...s, selected: !s.selected } : s)));
  };

  const addCustomSubreddit = (name: string) => {
    if (subreddits.some((s) => s.name.toLowerCase() === name.toLowerCase())) return;
    setSubreddits((prev) => [...prev, { name, subscribers: 0, selected: true }]);
  };

  const changeList = (key: "competitorKeywords" | "topicKeywords", change: (list: Array<{ value: string }>) => Array<{ value: string }>) => {
    setConfig((current) => {
      if (!current) return current;
      const updated = { ...current, [key]: change(current[key]) };
      knownRef.current = updated;
      return updated;
    });
  };

  const addNamed = (key: "competitorKeywords" | "topicKeywords", value: string) =>
    changeList(key, (list) =>
      list.some((item) => item.value.toLowerCase() === value.toLowerCase()) ? list : [...list, { value }],
    );

  const removeNamed = (key: "competitorKeywords" | "topicKeywords", value: string) =>
    changeList(key, (list) => list.filter((item) => item.value !== value));

  const startOver = () => {
    knownRef.current = null;
    summaryRef.current = "";
    historyRef.current = [];
    setConfig(null);
    setSubreddits([]);
    setFailure(null);
    setStage("start");
  };

  const begin = (start: SessionStart) => {
    const seeded: Config = {
      companyName: start.companyName,
      product: start.description,
      buyer: "",
      keepWhen: start.want,
      notAbout: "",
      brandKeywords: [{ value: start.companyName, aliases: [] }],
      competitorKeywords: [],
      topicKeywords: [],
      focusAreas: [],
    };
    knownRef.current = seeded;
    setConfig(seeded);
    setStage("extras");
  };

  /** Runs the setup once, with the optional answers included when they were given. */
  const finishDetails = (extras: BriefExtras) => {
    const base = knownRef.current;
    if (!base) return;
    const seeded = { ...base, buyer: extras.buyer, notAbout: extras.notAbout };
    knownRef.current = seeded;
    summaryRef.current = chatSummary(seeded);
    setConfig(seeded);
    const parts = [`${seeded.companyName} sells ${seeded.product}.`, `Find ${seeded.keepWhen}.`];
    if (seeded.buyer) parts.push(`Buyers: ${seeded.buyer}.`);
    if (seeded.notAbout) parts.push(`Skip: ${seeded.notAbout}.`);
    void run(parts.join(" "));
  };

  return (
    <OnboardingLayout
      embedded={embedded}
      actions={
        onCancel && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        )
      }
    >
      <ul className="steps mb-6 w-full text-xs">
        <li className="step step-primary">Details</li>
        <li className={`step ${stage === "review" ? "step-primary" : ""}`}>Review</li>
        <li className={`step ${saveConfig.isPending ? "step-primary" : ""}`}>Monitor</li>
      </ul>

      {stage === "start" && <SessionStartModal onStart={begin} onCancel={onCancel} />}

      {stage === "extras" && config && (
        <BriefExtrasModal
          companyName={config.companyName}
          onSave={finishDetails}
          onDismiss={() => finishDetails({ buyer: "", notAbout: "" })}
        />
      )}

      {stage === "question" && (
        <QuestionModal
          key={question}
          question={question}
          onAnswer={(answer) => void run(answer)}
          onCancel={onCancel}
        />
      )}

      {stage === "working" && (
        <section className="card card-border bg-base-100">
          <div className="card-body gap-2">
            <h2 className="card-title text-base">
              <span className="loading loading-spinner loading-sm" aria-hidden />
              Setting up {config?.companyName || "your session"}
            </h2>
            <p className="text-sm text-base-content/70">
              Picking competitors, topics, and subreddits. This takes a few seconds.
            </p>
            <ThinkingTrace steps={steps} activity={activity} running />
          </div>
        </section>
      )}

      {stage === "failed" && (
        <div role="alert" className="alert alert-error alert-soft">
          <span>{failure}</span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-sm btn-ghost" onClick={startOver}>
              Start over
            </button>
            <button type="button" className="btn btn-sm" onClick={() => void run(lastMessageRef.current)}>
              Try again
            </button>
          </div>
        </div>
      )}

      {stage === "review" && config && (
        <div className="animate-rise-in space-y-4">
          <ConfigReviewCard
            config={config}
            subreddits={subreddits}
            onToggleSubreddit={toggleSubreddit}
            onAddSubreddit={addCustomSubreddit}
            onAddCompetitor={(value) => addNamed("competitorKeywords", value)}
            onRemoveCompetitor={(value) => removeNamed("competitorKeywords", value)}
            onAddTopic={(value) => addNamed("topicKeywords", value)}
            onRemoveTopic={(value) => removeNamed("topicKeywords", value)}
            onConfirm={() => void handleSave(config)}
            onStartOver={startOver}
            isSaving={saveConfig.isPending}
          />
          {saveSteps.length > 0 && <ThinkingTrace steps={saveSteps} running={saveConfig.isPending} />}
          {saveError && (
            <div role="alert" className="alert alert-error alert-soft">
              <span>{saveError}</span>
            </div>
          )}
        </div>
      )}
    </OnboardingLayout>
  );
}
