import { createHash } from "node:crypto";
import type { HistoricalRecord, PredictorInput } from "../contracts/types.js";

/**
 * SESSION E2 — fixed real-model predictor prompt template.
 *
 * Every DEV causal condition (A0/A1/A2/A3) shares this exact base
 * instruction block and output contract; only the optional rulebook/history
 * context sections differ (see buildPrompt). Frozen predictor input surface
 * is exactly PredictorInput (title/body/createdAt/authorAssociation) per
 * EVAL_CONTRACT.md §12.6 — the issue number is never interpolated here.
 */
export const PROMPT_TEMPLATE_VERSION = "unwritten-dev-bakeoff-real-model-prompt-v1";

const BASE_INSTRUCTIONS = `You are an issue-triage classifier for a software project's GitHub issue tracker.

Given the issue described below, decide how it was actually resolved:
- RESOLVED_COMPLETED: the maintainers completed new work (a fix, change, or feature) that addressed the issue.
- RESOLVED_NO_NEW_WORK: the issue was closed without any new work being needed (for example: not planned, duplicate, invalid, already resolved, works as intended, or abandoned/stale).`;

const OUTPUT_CONTRACT = `Respond with EXACTLY one of the following two labels, character-for-character, and nothing else. No explanation. No markdown. No punctuation. No additional words before or after the label.
RESOLVED_COMPLETED
RESOLVED_NO_NEW_WORK`;

const RULEBOOK_HEADER =
  "The project maintains the following behavioral rules, learned from historical issue outcomes. Use them as guidance when relevant to this issue:";

const HISTORY_HEADER_PREFIX =
  "Here are up to";
const HISTORY_HEADER_SUFFIX =
  "similar past issues from this project's history (most recent first), with their actual resolutions, for reference:";

/** Minimal shape both A2's scrambled PolicyRule[] and A3's real Rule[] can be projected to for prompt rendering. */
export interface PromptRuleView {
  readonly id: string;
  readonly recommendedBehavior: string;
  readonly rationale?: string;
}

function renderIssueBlock(input: PredictorInput): string {
  return [`Title: ${input.title}`, `Body:`, input.body, `Author association: ${input.authorAssociation}`, `Created at: ${input.createdAt}`].join(
    "\n",
  );
}

function renderRulebookSection(rules: readonly PromptRuleView[]): string {
  if (rules.length === 0) return "";
  const items = rules.map((r) => `- ${r.id}: recommended resolution ${r.recommendedBehavior}${r.rationale ? ` (applies when: ${r.rationale})` : ""}`);
  return `\n\n${RULEBOOK_HEADER}\n\n${items.join("\n")}`;
}

function renderHistorySection(history: readonly HistoricalRecord[]): string {
  if (history.length === 0) return "";
  const items = history.map(
    (h, i) =>
      `${i + 1}. Title: ${h.title}\n   Body: ${h.body}\n   Author association: ${h.authorAssociation}\n   Actual resolution: ${h.label}`,
  );
  return `\n\n${HISTORY_HEADER_PREFIX} ${history.length} ${HISTORY_HEADER_SUFFIX}\n\n${items.join("\n\n")}`;
}

export interface PromptExtras {
  readonly rules?: readonly PromptRuleView[];
  readonly history?: readonly HistoricalRecord[];
}

/**
 * Builds the complete predictor prompt for one DEV item under one causal
 * condition. Section order is fixed: base instructions, issue block,
 * rulebook (if any), history (if any), output contract — identical across
 * A0/A1/A2/A3 whenever a given section is present, so the ONLY difference
 * between conditions is which optional sections are populated.
 */
export function buildPrompt(input: PredictorInput, extras: PromptExtras = {}): string {
  const parts = [BASE_INSTRUCTIONS, "", "Issue:", renderIssueBlock(input)];
  if (extras.rules && extras.rules.length > 0) parts.push(renderRulebookSection(extras.rules));
  if (extras.history && extras.history.length > 0) parts.push(renderHistorySection(extras.history));
  parts.push("", OUTPUT_CONTRACT);
  return parts.join("\n");
}

/**
 * Hash of the fixed template skeleton (instructions + contract + section
 * headers) — NOT of any per-item rendered prompt, which necessarily varies.
 * This is what "prompt template version/hash" freezes for the run config.
 */
export function promptTemplateHash(): string {
  const skeleton = [BASE_INSTRUCTIONS, RULEBOOK_HEADER, HISTORY_HEADER_PREFIX, HISTORY_HEADER_SUFFIX, OUTPUT_CONTRACT].join("\n---\n");
  return createHash("sha256").update(skeleton).digest("hex");
}

export const RESOLUTION_LABELS = ["RESOLVED_COMPLETED", "RESOLVED_NO_NEW_WORK"] as const;
