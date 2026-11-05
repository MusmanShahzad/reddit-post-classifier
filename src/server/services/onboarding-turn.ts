/**
 * One setup step: safety checks, then GPT-4o reads the details and either
 * builds the setup or writes one question. Every step is reported as it
 * happens, so the setup screen can show progress.
 *
 * @module services/onboarding-turn
 */

import { z } from "zod";
import { packHistory } from "@/lib/chat-context";
import {
  briefAnswerCounts,
  chatSummary,
  cleanBrief,
  declinesSkip,
  missingBrief,
  NOTHING_TO_SKIP,
  readyToMove,
  REQUIRED_BRIEF_COUNT,
  replyGuidance,
  type ProductBrief,
} from "@/lib/relevance";
import type { db as dbType } from "@/server/db";
import { checkGuardrails } from "./classifier";
import { checkModeration, extractOnboardingConfig, suggestMarketNames, type ExtractionOutput } from "./openai";

type PrismaClient = typeof dbType;

export type StepStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface PipelineStep {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

export type TurnPhase = "initial" | "clarifying" | "confirming" | "complete";

export interface TurnResult {
  reply: string;
  phase: TurnPhase;
  config: ExtractionOutput["config"] | null;
  /** Memory passed with the next message once the raw chat gets long. */
  summary: string;
  pipelineSteps: PipelineStep[];
}

/** What the setup screen shows while a step runs. */
export type TurnEvent =
  | { type: "step"; step: PipelineStep }
  | { type: "activity"; text: string }
  | { type: "reply"; text: string }
  | { type: "done"; result: TurnResult }
  | { type: "error"; message: string };

const KnownConfigSchema = z.object({
  companyName: z.string().max(100).optional(),
  product: z.string().max(300).optional(),
  buyer: z.string().max(300).optional(),
  keepWhen: z.string().max(400).optional(),
  notAbout: z.string().max(400).optional(),
  brandKeywords: z.array(z.object({ value: z.string().max(100), aliases: z.array(z.string().max(50)).max(10), ambiguous: z.boolean().optional() })).max(5).optional(),
  competitorKeywords: z.array(z.object({ value: z.string().max(100), aliases: z.array(z.string().max(50)).max(10).optional(), ambiguous: z.boolean().optional() })).max(10).optional(),
  topicKeywords: z.array(z.object({ value: z.string().max(200) })).max(15).optional(),
  focusAreas: z.array(z.string().max(200)).max(10).optional(),
});

export const TurnInputSchema = z.object({
  message: z.string().min(1).max(2000),
  conversationHistory: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(60),
  /** Groups this chat's turns in the log until the session is saved. */
  draftId: z.string().min(8).max(64).optional(),
  /** Answers already taken from earlier messages. A short reply must not wipe them. */
  known: KnownConfigSchema.optional(),
  /** Saved summary of the earlier messages. */
  summary: z.string().max(1200).optional(),
});

export type TurnInput = z.infer<typeof TurnInputSchema>;

const STEP_LABELS: [string, string][] = [
  ["validation", "Reading your details"],
  ["moderation", "Safety check"],
  ["guardrails", "Business check"],
  ["extraction", "Building your setup"],
];

function earlierUserLines(history: TurnInput["conversationHistory"] = []): string[] {
  return history
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter((line) => line.length > 0)
    .slice(-4);
}

function lastAssistantQuestion(history: TurnInput["conversationHistory"] = []): string {
  return [...history].reverse().find((message) => message.role === "assistant")?.content ?? "";
}

/** Facts already gathered, plus the user's earlier messages, so a short reply stays in this chat. */
function setupSoFar(
  known: TurnInput["known"],
  history: TurnInput["conversationHistory"] = [],
  summary = "",
): string | null {
  const kept = cleanBrief({
    product: known?.product ?? "",
    buyer: known?.buyer ?? "",
    keepWhen: known?.keepWhen ?? "",
    notAbout: known?.notAbout ?? "",
  });
  const bits = [
    kept.product ? `They sell ${kept.product}.` : "",
    kept.buyer ? `Buyers: ${kept.buyer}.` : "",
    kept.keepWhen ? `They want found: ${kept.keepWhen}.` : "",
    kept.notAbout ? `Skip: ${kept.notAbout}.` : "",
  ].filter((line) => line.length > 0);
  const earlier = earlierUserLines(history);
  if (earlier.length > 0) bits.push(`Earlier in this chat: ${earlier.join(" | ")}.`);
  if (summary.trim()) bits.push(`Saved summary: ${summary.trim().slice(0, 500)}`);
  return bits.length > 0 ? bits.join(" ") : null;
}

/** Runs a turn. `emit` receives each step and the reply as it is written. */
export async function answerTurn(
  input: Pick<TurnInput, "message" | "conversationHistory" | "known" | "summary">,
  emit: (event: TurnEvent) => void = () => undefined,
): Promise<TurnResult> {
  const steps: PipelineStep[] = STEP_LABELS.map(([id, label]) => ({ id, label, status: "pending" }));
  const set = (id: string, status: StepStatus, detail?: string) => {
    const step = steps.find((s) => s.id === id)!;
    step.status = status;
    step.detail = detail;
    emit({ type: "step", step: { ...step } });
  };
  const say = (text: string) => emit({ type: "activity", text });
  const skipRest = (from: number) => {
    for (const [id] of STEP_LABELS.slice(from)) set(id, "skipped");
  };
  const carried = input.summary?.trim() ?? "";
  const finish = (reply: string, phase: TurnPhase, config: TurnResult["config"] = null, summary = carried): TurnResult => {
    emit({ type: "reply", text: reply });
    return { reply, phase, config, summary, pipelineSteps: steps.map((s) => ({ ...s })) };
  };

  // Layer 1: input validation
  set("validation", "running");
  say("Reading your message");
  const trimmed = input.message.trim();
  const setup = setupSoFar(input.known, input.conversationHistory, carried);
  if (trimmed.length < 5 && !setup) {
    set("validation", "error", "Too short");
    skipRest(1);
    return finish("Could you tell me more? I need at least a company or product name to get started.", "initial");
  }
  set("validation", "done");

  // Layer 2: OpenAI moderation (free). If it is down, later layers still run.
  set("moderation", "running");
  say("Checking the message is safe to process");
  let flagged = false;
  try {
    flagged = (await checkModeration(trimmed)).flagged;
  } catch (error) {
    console.error("Moderation API error (non-fatal):", error);
  }
  if (flagged) {
    set("moderation", "error", "Flagged");
    skipRest(2);
    return finish(
      "I can only help with business monitoring. Let's focus on your company or product — what would you like to track?",
      "initial",
    );
  }
  set("moderation", "done", "Passed");

  // Layer 3: Jev business check
  set("guardrails", "running");
  say("Making sure this is about a business, not a person");
  let passed = true;
  let blockedReason: string | null = null;
  let followUp = false;
  try {
    const guardrail = await checkGuardrails(trimmed, setup ?? undefined);
    passed = guardrail.passed;
    blockedReason = guardrail.reason ?? null;
    // A short answer in a chat that is already about a business is not a new
    // request. Only a reply that targets a person still stops the chat.
    if (!passed && setup && guardrail.scores.targetsIndividual <= 0.6) {
      passed = true;
      followUp = true;
    }
  } catch (error) {
    console.error("Guardrail check error (non-fatal):", error);
  }
  if (!passed) {
    set("guardrails", "error", "Not business-related");
    skipRest(3);
    return finish(blockedReason ?? "I can only help monitor businesses and products.", "initial");
  }
  set("guardrails", "done", followUp ? "Follow-up in this chat" : "Business confirmed");

  // Layer 4: GPT-4o reads the whole chat and writes the reply
  set("extraction", "running");
  say("Working out the company, what they sell, and what to find");
  try {
    const packed = packHistory(input.conversationHistory, carried || chatSummary(input.known));
    if (packed.trimmed) say("Using the saved summary of the earlier messages");
    const extraction = await extractOnboardingConfig(packed.history, trimmed, {
      onReply: (text) => emit({ type: "reply", text }),
      guidance: replyGuidance(input.known, earlierUserLines(input.conversationHistory)),
      summary: packed.summary,
    });

    const config = remember(extraction.config ?? null, input.known);
    if (config) config.competitorKeywords = tidyCompetitors(config.competitorKeywords, config.companyName);
    if (config && !extraction.needsClarification && missingBrief(config).length === 0) {
      await fillMarketNames(config, say);
    }
    if (
      config &&
      declinesSkip(trimmed) &&
      !briefAnswerCounts(config.notAbout) &&
      /skip/i.test(lastAssistantQuestion(input.conversationHistory))
    ) {
      config.notAbout = NOTHING_TO_SKIP;
    }
    const missing = missingBrief(config);
    const filled = REQUIRED_BRIEF_COUNT - missing.length;
    set("extraction", "done", `${filled} of ${REQUIRED_BRIEF_COUNT} answers`);
    for (const line of understood(config)) say(line);

    const summary = chatSummary(config, extraction.conversationSummary || carried);

    // The model decides when an answer is unclear. A blank field still has to be asked.
    if (missing.length > 0 || !config || extraction.needsClarification) {
      say(missing.length > 0 ? `Still need: ${missing.join(", ")}` : "The answer needs a clearer question");
      return finish(extraction.conversationalReply.trim(), "clarifying", config, summary);
    }

    if (extraction.isConfirmation) {
      say("You confirmed the setup");
      return finish(extraction.conversationalReply, "complete", config, summary);
    }
    say("Setup is ready for you to review");
    return finish(readyToMove(), "confirming", config, summary);
  } catch (error) {
    console.error("Extraction error:", error);
    set("extraction", "error", extractionErrorDetail(error));
    return finish(
      "Sorry, I had trouble reading that. Please say it again: what you sell, and what you want found.",
      "initial",
    );
  }
}

type SavedConfig = NonNullable<ExtractionOutput["config"]>;

/** Drops blanks, repeats, and the company itself from the competitor list. */
export function tidyCompetitors<T extends { value: string }>(list: T[], companyName: string): T[] {
  const own = companyName.trim().toLowerCase();
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const item of list) {
    const value = item.value.trim();
    const key = value.toLowerCase();
    if (!value || key === own || seen.has(key)) continue;
    seen.add(key);
    kept.push({ ...item, value });
  }
  return kept;
}

/**
 * Fills competitors and brand spellings the setup step left empty. Names that
 * are already there, including any the user gave, are never replaced.
 */
async function fillMarketNames(config: SavedConfig, say: (text: string) => void): Promise<void> {
  const brand = config.brandKeywords[0];
  const needsCompetitors = config.competitorKeywords.length === 0;
  const needsAliases = !!brand && brand.aliases.length === 0;
  if (!needsCompetitors && !needsAliases) return;

  say("Looking up competitors and other spellings of the name");
  const found = await suggestMarketNames(config);

  if (needsCompetitors) {
    config.competitorKeywords = tidyCompetitors(found.competitors, config.companyName);
  }
  if (brand && needsAliases) {
    const name = brand.value.trim().toLowerCase();
    brand.aliases = [...new Set(found.brandAliases.map((alias) => alias.trim()))].filter(
      (alias) => alias && alias.toLowerCase() !== name,
    );
  }
}

/** Keeps an earlier answer when this message did not repeat it. A new answer wins. */
function remember(extracted: SavedConfig | null, known: TurnInput["known"]): SavedConfig | null {
  if (!extracted && !known) return null;
  const next = extracted ?? {
    companyName: "",
    product: "",
    buyer: "",
    keepWhen: "",
    notAbout: "",
    brandKeywords: [],
    competitorKeywords: [],
    topicKeywords: [],
    focusAreas: [],
  };
  if (!known) return cleanBrief(extracted ?? next);
  const text = (key: keyof ProductBrief, fresh: string, earlier?: string) =>
    briefAnswerCounts(fresh) ? fresh.trim() : briefAnswerCounts(earlier) ? (earlier ?? "").trim() : "";
  const list = <T>(fresh: T[], earlier?: T[]) => (fresh.length > 0 ? fresh : (earlier ?? []));
  return cleanBrief({
    ...next,
    companyName: next.companyName.trim() || known.companyName || "",
    product: text("product", next.product, known.product),
    buyer: text("buyer", next.buyer, known.buyer),
    keepWhen: text("keepWhen", next.keepWhen, known.keepWhen),
    notAbout: text("notAbout", next.notAbout, known.notAbout),
    brandKeywords: list(next.brandKeywords, known.brandKeywords),
    competitorKeywords: list(next.competitorKeywords, known.competitorKeywords),
    topicKeywords: list(next.topicKeywords, known.topicKeywords),
    focusAreas: list(next.focusAreas ?? [], known.focusAreas),
  });
}

/** Plain lines for what the assistant took from the chat so far. */
function understood(config: TurnResult["config"]): string[] {
  if (!config) return [];
  const lines: string[] = [];
  if (config.companyName) lines.push(`Company: ${config.companyName}`);
  if (config.product) lines.push(`They sell: ${config.product}`);
  if (config.buyer) lines.push(`Customers: ${config.buyer}`);
  if (config.keepWhen) lines.push(`Find: ${config.keepWhen}`);
  if (config.notAbout) lines.push(`Skip: ${config.notAbout}`);
  const rivals = config.competitorKeywords.map((item) => item.value).slice(0, 6);
  if (rivals.length > 0) lines.push(`Competitors: ${rivals.join(", ")}`);
  const searches = config.topicKeywords.map((topic) => topic.value).slice(0, 6);
  if (searches.length > 0) lines.push(`Searches so far: ${searches.join(", ")}`);
  return lines;
}

function extractionErrorDetail(error: unknown): string {
  if (error instanceof z.ZodError) return "Could not read the answer";
  if (error instanceof SyntaxError) return "AI returned non-JSON";
  if (error instanceof Error) {
    if (error.message.includes("Empty response")) return "AI returned empty response";
    if (error.message.includes("rate") || error.message.includes("429")) return "Rate limited — try again";
    if (error.message.includes("timeout") || error.message.includes("ETIMEDOUT")) return "Request timed out";
  }
  return "Unexpected error";
}

/** Stores the user's message and the reply. Logging never blocks the chat. */
export async function logTurn(
  db: PrismaClient,
  input: { message: string; draftId?: string },
  result: TurnResult,
  activity: string[] = [],
) {
  if (!input.draftId) return;
  const blocked = result.pipelineSteps.some((step) => step.status === "error");
  try {
    await db.chatMessage.createMany({
      data: [
        { draftId: input.draftId, role: "user", content: input.message },
        {
          draftId: input.draftId,
          role: "assistant",
          content: result.reply,
          phase: blocked ? "blocked" : result.phase,
          metadata: JSON.stringify({
            config: result.config,
            missing: missingBrief(result.config),
            summary: result.summary,
            steps: result.pipelineSteps,
            activity,
          }),
        },
      ],
    });
  } catch (error) {
    console.warn("[onboarding] could not log the turn:", error instanceof Error ? error.message : "Unknown");
  }
}
