import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadGroundTruth } from "../src/data/manifests.js";
import { loadPredictorInputs } from "../src/data/predictorInput.js";
import { loadDevEvalHistoricalCorpus, HistoricalRecordStore } from "../src/data/historicalRecords.js";
import { readSnapshotFile, describeConditions } from "../src/rulebook/snapshot.js";
import { createRulebookToolHeuristics } from "../src/rulebook/toolHeuristicAdapter.js";
import { DEV_HISTORICAL_SEARCH_TOP_K } from "../src/eval/retrievalConfig.js";
import { makeA3Predictor, type Predictor } from "../src/eval/harness.js";
import { evaluate } from "../src/eval/metrics.js";
import type { EvaluationResult, Prediction, PredictorInput, ResolutionDisposition } from "../src/contracts/types.js";
import type { ToolHeuristicContext, ToolHeuristicHooks } from "../src/tools/toolHeuristics.js";
import { buildPrompt, promptTemplateHash, type PromptRuleView } from "../src/model/promptTemplate.js";
import { predictWithCli, type PredictWithCliResult } from "../src/model/predict.js";
import {
  invokeClaudeCliOnce,
  CLAUDE_CLI_MODEL,
  CLAUDE_CLI_ISOLATION_FLAGS,
  neutralCliCwd,
  ClaudeCliIntegrityViolation,
} from "../src/model/claudeCli.js";

/**
 * SESSION E4 — BOUNDED TOOL-SEARCH RECOVERY (A3 DEV rerun, post-fix)
 *
 * Reruns the frozen A3 condition ONLY across all 66 DEV items with the EXACT
 * SESSION E2/E3R frozen inference configuration (prompt template hash, V3
 * Rulebook hash, TRAIN corpus hash, retrieval top-k, isolation flags, one
 * fresh CLI process per prediction, concurrency 4, one retry only on
 * transport/parser failure). The ONLY production change relative to E3R is
 * the Rulebook -> ToolHeuristicHooks search-decision logic
 * (src/rulebook/toolHeuristicAdapter.ts): a matching active rule now only
 * suppresses historical search if it beats the base rate its own TRAIN
 * evidence implies (halves the residual error) and the matching rules agree.
 *
 * E3R artifacts under reports/dev_bakeoff/a3_recovery/ are the preserved
 * pre-fix diagnostic and are NOT touched. This run writes only under
 * reports/dev_bakeoff/a3_recovery_v2/. FINAL_HOLDOUT is never touched.
 */

const CONDITION = "A3" as const;
const CONCURRENCY = 4;
const CIRCUIT_BREAKER_CONSECUTIVE = 3;

// Frozen invariants carried forward from SESSION E2/E3R (reports/dev_bakeoff/config.json).
const FROZEN_PROMPT_TEMPLATE_HASH = "eb428176b882450cf2b54095b4d27d077540b04d4003b443f7633fefd999df13";
const FROZEN_V3_RULEBOOK_HASH = "f9bf2abe268d34cd5c8f900500ff5171a663e8e4b53f96061fb1211aa10c86eb";
const FROZEN_TRAIN_CORPUS_HASH = "06af38f29d00d703d0c134cfb1f3a82361c7227bc56d09e2bb74a0bbe64683d3";
const FROZEN_ACTIVE_RULES_COUNT = 12;
const MAX_ACTIVE_RULES = 15;

// SESSION E2 A0 canonical complete result (66/66) — cross-session comparison anchor only.
const E2_A0_CANONICAL_MACRO_F1 = 0.6042328042328042;
const E2_A0_CANONICAL_ACCURACY = 0.7424242424242424;

// SESSION E3R pre-fix A3 canonical complete result (66/66) — the pre-fix diagnostic this iteration is measured against.
const E3R_PREFIX_A3_MACRO_F1 = 0.5307045895281188;
const E3R_PREFIX_A3_ACCURACY = 0.8333333333333334;

const RECOVERY_DIR = path.resolve("reports", "dev_bakeoff", "a3_recovery_v2");
const PREDICTIONS_PATH = path.join(RECOVERY_DIR, "predictions.jsonl");
const CONFIG_PATH = path.join(RECOVERY_DIR, "config.json");
const METRICS_PATH = path.join(RECOVERY_DIR, "metrics.json");
const USAGE_PATH = path.join(RECOVERY_DIR, "usage.json");
const REPORT_MD_PATH = path.join(RECOVERY_DIR, "A3_RECOVERY_V2_REPORT.md");

const MEMORY_DIR = path.resolve("memory");
const MEMORY_VERSIONS = ["V0", "V1", "V2", "V3"] as const;

const BLOCKED_CODE = "BLOCKED_ACCOUNT_ROUTE_UNRELIABLE";

function sha256File(p: string): string {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

function memoryHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of MEMORY_VERSIONS) out[v] = sha256File(path.join(MEMORY_DIR, `${v}.json`));
  return out;
}

function hashesEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  return MEMORY_VERSIONS.every((v) => a[v] === b[v]);
}

interface CallRecord {
  readonly latencyMs: number;
  readonly totalCostUsd: number;
  readonly modelUsage: Record<string, unknown>;
  readonly webSearchRequests: number;
  readonly webFetchRequests: number;
  readonly subagentsSpawned: number;
}

interface PredictionRecord {
  readonly condition: "A3";
  readonly number: number;
  readonly predicted: ResolutionDisposition;
  readonly error?: string;
  readonly retried: boolean;
  readonly latencyMs: number;
  readonly searched: boolean;
  readonly calls: readonly CallRecord[];
}

function toCallRecord(c: PredictWithCliResult["calls"][number]): CallRecord {
  return {
    latencyMs: c.latencyMs,
    totalCostUsd: c.totalCostUsd,
    modelUsage: c.modelUsage,
    webSearchRequests: c.webSearchRequests,
    webFetchRequests: c.webFetchRequests,
    subagentsSpawned: c.subagentsSpawned,
  };
}

function loadExistingPredictions(): PredictionRecord[] {
  if (!existsSync(PREDICTIONS_PATH)) return [];
  return readFileSync(PREDICTIONS_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as PredictionRecord)
    .filter((r) => r.condition === "A3" && typeof r.number === "number");
}

function appendPrediction(record: PredictionRecord): void {
  mkdirSync(RECOVERY_DIR, { recursive: true });
  appendFileSync(PREDICTIONS_PATH, JSON.stringify(record) + "\n", "utf8");
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function failureSignature(message: string): string {
  const exit = message.match(/claude CLI exited with code (-?\d+)\. stderr: ([\s\S]*)$/);
  if (exit) {
    const stderr = exit[2]!.trim();
    return `exit-code-${exit[1]}-stderr-${stderr.length === 0 ? "empty" : "present"}`;
  }
  if (/killed by signal/.test(message)) return "process-killed-timeout";
  if (/spawn failed/.test(message)) return "spawn-failed";
  if (/stdout was not valid JSON/.test(message)) return "non-json-stdout";
  if (/reported is_error=true/.test(message)) return "envelope-is-error";
  return `other:${message.slice(0, 80)}`;
}

async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
  shouldAbort: () => boolean,
): Promise<void> {
  let next = 0;
  let aborted: unknown = null;
  async function worker(): Promise<void> {
    while (next < items.length && !aborted && !shouldAbort()) {
      const i = next++;
      try {
        await fn(items[i]!);
      } catch (err) {
        aborted = err;
        return;
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  if (aborted) throw aborted;
}

interface A3PredictorBundle {
  readonly predictor: Predictor;
  readonly searchCounter: { count: number };
  readonly searchedInputs: WeakSet<PredictorInput>;
  readonly activeRulesCount: number;
}

function buildA3Predictor(callMeta: WeakMap<PredictorInput, PredictWithCliResult>): A3PredictorBundle {
  const { records: corpusRecords } = loadDevEvalHistoricalCorpus();
  const store = new HistoricalRecordStore(corpusRecords);

  const v3 = readSnapshotFile("memory", "V3");
  if (!v3.available || !v3.snapshot) {
    throw new Error("memory/V3.json not present — cannot run A3.");
  }
  const activeRules = v3.snapshot.rules.filter((r) => r.status === "active");
  if (activeRules.length > MAX_ACTIVE_RULES) {
    throw new Error(`active rule count ${activeRules.length} exceeds MAX_ACTIVE_RULES=${MAX_ACTIVE_RULES}`);
  }

  const activeRulesView: PromptRuleView[] = activeRules.map((r) => ({
    id: r.id,
    recommendedBehavior: r.recommendedBehavior,
    rationale: `${describeConditions(r.conditions)} (confidence ${r.confidence.toFixed(2)}, support ${r.supportCount})`,
  }));

  async function callModel(input: PredictorInput, extras: Parameters<typeof buildPrompt>[1]): Promise<ResolutionDisposition> {
    const prompt = buildPrompt(input, extras);
    const res = await predictWithCliWithTransportRetry(prompt);
    callMeta.set(input, res);
    return res.disposition;
  }

  const searchCounter = { count: 0 };
  const searchedInputs = new WeakSet<PredictorInput>();
  const baseHeuristics = createRulebookToolHeuristics(activeRules);
  const countingHeuristics: ToolHeuristicHooks = {
    ...baseHeuristics,
    shouldSearch: (ctx: ToolHeuristicContext) => {
      const d = baseHeuristics.shouldSearch(ctx);
      if (d.action === "SEARCH") {
        searchCounter.count += 1;
        searchedInputs.add(ctx.input);
      }
      return d;
    },
  };

  const predictor = makeA3Predictor(store, DEV_HISTORICAL_SEARCH_TOP_K, activeRules, countingHeuristics, (input, _rules, history) =>
    callModel(input, { rules: activeRulesView, history }),
  );

  return { predictor, searchCounter, searchedInputs, activeRulesCount: activeRules.length };
}

async function predictWithCliWithTransportRetry(prompt: string): Promise<PredictWithCliResult> {
  try {
    return await predictWithCli(prompt);
  } catch (err) {
    if (err instanceof ClaudeCliIntegrityViolation) throw err;
    const retry = await predictWithCli(prompt);
    return { ...retry, retried: true };
  }
}

interface Task {
  readonly number: number;
  readonly input: PredictorInput;
}

async function runTask(
  task: Task,
  bundle: A3PredictorBundle,
  callMeta: WeakMap<PredictorInput, PredictWithCliResult>,
): Promise<PredictionRecord> {
  try {
    const disposition = await bundle.predictor(task.input);
    const res = callMeta.get(task.input);
    callMeta.delete(task.input);
    const searched = bundle.searchedInputs.has(task.input);
    if (!res) throw new Error("internal: no CLI call metadata captured for this prediction");
    return {
      condition: "A3",
      number: task.number,
      predicted: disposition,
      ...(res.parseFailureAfterRetry ? { error: "PARSE_FAILURE_AFTER_RETRY" } : {}),
      retried: res.retried,
      latencyMs: res.calls.reduce((s, c) => s + c.latencyMs, 0),
      searched,
      calls: res.calls.map(toCallRecord),
    };
  } catch (err) {
    if (err instanceof ClaudeCliIntegrityViolation) throw err;
    callMeta.delete(task.input);
    return {
      condition: "A3",
      number: task.number,
      predicted: "RESOLVED_COMPLETED", // placeholder; `error` marks this unscored
      error: err instanceof Error ? err.message : String(err),
      retried: false,
      latencyMs: 0,
      searched: bundle.searchedInputs.has(task.input),
      calls: [],
    };
  }
}

function writeBlockedConfig(detail: Record<string, unknown>): void {
  mkdirSync(RECOVERY_DIR, { recursive: true });
  writeFileSync(
    CONFIG_PATH,
    JSON.stringify(
      {
        session: "SESSION E4 — BOUNDED TOOL-SEARCH RECOVERY (A3 DEV rerun)",
        condition: CONDITION,
        gate: "BLOCKED",
        blocker_code: BLOCKED_CODE,
        ...detail,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

async function main(): Promise<void> {
  console.log("=== SESSION E4 — A3 DEV rerun (post tool-search fix, Claude Code CLI route) ===");

  // ---- frozen-invariant verification ----
  if (promptTemplateHash() !== FROZEN_PROMPT_TEMPLATE_HASH) {
    throw new Error(`prompt template hash drift: ${promptTemplateHash()} != frozen ${FROZEN_PROMPT_TEMPLATE_HASH}`);
  }
  const v3Hash = sha256File(path.resolve("memory", "V3.json"));
  if (v3Hash !== FROZEN_V3_RULEBOOK_HASH) {
    throw new Error(`V3 rulebook hash drift: ${v3Hash} != frozen ${FROZEN_V3_RULEBOOK_HASH}`);
  }
  const trainCorpusHash = sha256File(path.resolve("data", "train_feedback.jsonl"));
  if (trainCorpusHash !== FROZEN_TRAIN_CORPUS_HASH) {
    throw new Error(`TRAIN corpus hash drift: ${trainCorpusHash} != frozen ${FROZEN_TRAIN_CORPUS_HASH}`);
  }

  const cliVersion = execFileSync("claude", ["--version"], { encoding: "utf8", shell: true }).trim();
  console.log(`claude CLI version: ${cliVersion}`);

  const memoryBefore = memoryHashes();

  // ---- DEV items ----
  const { available: devAvailable, records, extraNumbers, missingNumbers } = loadPredictorInputs("DEV");
  if (!devAvailable) throw new Error("data/dev.jsonl not materialized.");
  if (extraNumbers.length > 0 || missingNumbers.length > 0) {
    throw new Error(`DEV issue-number set mismatch. extra=${extraNumbers.join(",")} missing=${missingNumbers.join(",")}`);
  }
  if (records.length !== 66) throw new Error(`expected exactly 66 DEV records, found ${records.length}`);

  const groundTruth = loadGroundTruth("DEV");
  const items: Task[] = [...records].sort((a, b) => a.number - b.number).map((r) => ({ number: r.number, input: r.input }));

  const callMeta = new WeakMap<PredictorInput, PredictWithCliResult>();
  const bundle = buildA3Predictor(callMeta);
  if (bundle.activeRulesCount !== FROZEN_ACTIVE_RULES_COUNT) {
    throw new Error(`active rules count ${bundle.activeRulesCount} != frozen ${FROZEN_ACTIVE_RULES_COUNT}`);
  }

  // ================= PREFLIGHT =================
  console.log("\n--- preflight ---");
  const preflight: Record<string, unknown> = {};

  async function transportCheck(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await invokeClaudeCliOnce("Reply with exactly the word PONG and nothing else.");
      const ok =
        res.resultText.trim().length > 0 &&
        res.webSearchRequests === 0 &&
        res.webFetchRequests === 0 &&
        res.subagentsSpawned === 0;
      return { ok, detail: res.resultText.trim().slice(0, 80) };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }
  let transport = await transportCheck();
  if (!transport.ok) {
    console.log(`  transport check failed once (${transport.detail}); one retry...`);
    transport = await transportCheck();
  }
  preflight.transport_check = transport;
  console.log(`  transport check: ${transport.ok ? "OK" : "FAILED"} (${transport.detail})`);

  const smokeItem = items[0]!;
  async function smokePredict(): Promise<{ ok: boolean; detail: string; latencyMs: number; costUsd: number; web: number; sub: number }> {
    try {
      const disposition = await bundle.predictor(smokeItem.input);
      const res = callMeta.get(smokeItem.input);
      callMeta.delete(smokeItem.input);
      const web = res ? res.calls.reduce((s, c) => s + c.webSearchRequests + c.webFetchRequests, 0) : 0;
      const sub = res ? res.calls.reduce((s, c) => s + c.subagentsSpawned, 0) : 0;
      const ok = !!res && !res.parseFailureAfterRetry && web === 0 && sub === 0;
      return {
        ok,
        detail: disposition,
        latencyMs: res ? res.calls.reduce((s, c) => s + c.latencyMs, 0) : 0,
        costUsd: res ? res.calls.reduce((s, c) => s + c.totalCostUsd, 0) : 0,
        web,
        sub,
      };
    } catch (err) {
      callMeta.delete(smokeItem.input);
      return { ok: false, detail: err instanceof Error ? err.message : String(err), latencyMs: 0, costUsd: 0, web: 0, sub: 0 };
    }
  }
  let smoke = await smokePredict();
  if (!smoke.ok) {
    console.log(`  A3 smoke failed once (${smoke.detail}); one retry...`);
    smoke = await smokePredict();
  }
  preflight.a3_smoke = smoke;
  console.log(`  A3 smoke prediction: ${smoke.ok ? "OK" : "FAILED"} -> ${smoke.detail} (${smoke.latencyMs}ms, $${smoke.costUsd.toFixed(4)})`);

  const noToolUse = (preflight.a3_smoke as { web: number; sub: number }).web === 0 && (preflight.a3_smoke as { web: number; sub: number }).sub === 0;

  const memoryAfterPreflight = memoryHashes();
  const memoryUnchangedPreflight = hashesEqual(memoryBefore, memoryAfterPreflight);
  preflight.memory_hashes_unchanged = memoryUnchangedPreflight;
  preflight.memory_hashes_before = memoryBefore;
  preflight.memory_hashes_after_preflight = memoryAfterPreflight;

  // NOTE: smoke prediction increments the search counter; reset before the scored run
  // so historical_search_calls reflects exactly the 66 scored items.
  bundle.searchCounter.count = 0;

  const preflightPass = transport.ok && smoke.ok && noToolUse && memoryUnchangedPreflight;
  console.log(`\npreflight: ${preflightPass ? "PASSED" : "FAILED"}`);

  if (!preflightPass) {
    writeBlockedConfig({ stage: "PREFLIGHT", preflight, cli_version: cliVersion });
    console.error(`\n${BLOCKED_CODE} — preflight failed after the single allowed retry. STOPPING before the 66-call run.`);
    process.exitCode = 1;
    return;
  }

  // ================= FULL A3 RUN =================
  const existing = loadExistingPredictions();
  const doneNumbers = new Set(existing.filter((r) => r.error === undefined).map((r) => r.number));
  console.log(`\n--- full A3 run: 66 DEV items (resuming ${doneNumbers.size}/66 already complete) ---`);
  const pending = items.filter((it) => !doneNumbers.has(it.number));
  // Re-seed the search counter from any resumed rows so the final count still covers 66 items.
  bundle.searchCounter.count = existing.filter((r) => r.error === undefined && r.searched).length;

  const circuit = { consecutive: 0, lastSignature: "", tripped: false, signature: "" };
  const runStart = Date.now();
  let integrityViolation: ClaudeCliIntegrityViolation | null = null;

  try {
    await runPool(
      pending,
      CONCURRENCY,
      async (task) => {
        const record = await runTask(task, bundle, callMeta);
        appendPrediction(record);
        if (record.error) {
          const sig = failureSignature(record.error);
          if (sig === circuit.lastSignature) circuit.consecutive += 1;
          else {
            circuit.lastSignature = sig;
            circuit.consecutive = 1;
          }
          console.log(`  [A3 #${record.number}] ERROR (${record.error.slice(0, 120)}) [sig=${sig} x${circuit.consecutive}]`);
          if (circuit.consecutive >= CIRCUIT_BREAKER_CONSECUTIVE) {
            circuit.tripped = true;
            circuit.signature = sig;
          }
        } else {
          circuit.consecutive = 0;
          circuit.lastSignature = "";
          console.log(`  [A3 #${record.number}] ${record.predicted}${record.searched ? " (searched)" : ""}${record.retried ? " (retried)" : ""}`);
        }
      },
      () => circuit.tripped,
    );
  } catch (err) {
    if (err instanceof ClaudeCliIntegrityViolation) {
      integrityViolation = err;
    } else {
      throw err;
    }
  }
  const runDurationMs = Date.now() - runStart;

  const memoryAfterRun = memoryHashes();
  const memoryUnchangedOverall = hashesEqual(memoryBefore, memoryAfterRun);

  const allPredictions = loadExistingPredictions();
  const complete = allPredictions.filter((r) => r.error === undefined);
  const errored = allPredictions.filter((r) => r.error !== undefined);

  let webSearchTotal = 0;
  let webFetchTotal = 0;
  let subagentsTotal = 0;
  for (const r of allPredictions) {
    for (const c of r.calls) {
      webSearchTotal += c.webSearchRequests;
      webFetchTotal += c.webFetchRequests;
      subagentsTotal += c.subagentsSpawned;
    }
  }

  const searchedCount = complete.filter((r) => r.searched).length;

  if (integrityViolation) {
    writeBlockedConfig({
      blocker_code: "TOOL_USE_INTEGRITY_VIOLATION",
      stage: "FULL_RUN",
      detail: integrityViolation.message,
      envelope: integrityViolation.envelope,
      predictions_complete_before_abort: complete.length,
      memory_hashes_unchanged: memoryUnchangedOverall,
    });
    console.error(`\nINVALID: ${integrityViolation.message}`);
    process.exitCode = 1;
    return;
  }

  if (circuit.tripped) {
    writeBlockedConfig({
      stage: "FULL_RUN",
      circuit_breaker: { tripped: true, consecutive_failures: CIRCUIT_BREAKER_CONSECUTIVE, signature: circuit.signature },
      predictions_complete: complete.length,
      predictions_errored: errored.length,
      checkpoint_preserved: PREDICTIONS_PATH,
      memory_hashes_unchanged: memoryUnchangedOverall,
      integrity: { web_search_requests_total: webSearchTotal, web_fetch_requests_total: webFetchTotal, subagents_spawned_total: subagentsTotal },
    });
    console.error(`\n${BLOCKED_CODE} — circuit breaker tripped (${CIRCUIT_BREAKER_CONSECUTIVE} consecutive '${circuit.signature}'). Checkpoint preserved.`);
    process.exitCode = 1;
    return;
  }

  // ================= METRICS (only if 66/66 valid) =================
  const predictions: Prediction[] = complete.map((r) => ({ number: r.number, predicted: r.predicted }));
  const allComplete = complete.length === 66 && errored.length === 0;

  let evalResult: EvaluationResult | null = null;
  if (allComplete) {
    evalResult = evaluate("DEV", groundTruth, predictions);
  }

  // ---- usage aggregation ----
  const latencies = complete.map((r) => r.latencyMs).sort((a, b) => a - b);
  const retries = allPredictions.filter((r) => r.retried).length;
  const modelCalls = allPredictions.reduce((s, r) => s + r.calls.length, 0);
  const aggregateModelUsage: Record<
    string,
    { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; costUSD: number; calls: number }
  > = {};
  let totalCostUsd = 0;
  for (const r of allPredictions) {
    for (const c of r.calls) {
      totalCostUsd += c.totalCostUsd;
      for (const [model, usage] of Object.entries(c.modelUsage as Record<string, Record<string, unknown>>)) {
        const agg = (aggregateModelUsage[model] ??= {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUSD: 0,
          calls: 0,
        });
        agg.inputTokens += Number(usage.inputTokens ?? 0);
        agg.outputTokens += Number(usage.outputTokens ?? 0);
        agg.cacheReadInputTokens += Number(usage.cacheReadInputTokens ?? 0);
        agg.cacheCreationInputTokens += Number(usage.cacheCreationInputTokens ?? 0);
        agg.costUSD += Number(usage.costUSD ?? 0);
        agg.calls += 1;
      }
    }
  }

  const usage = {
    condition: CONDITION,
    total_predictions: allPredictions.length,
    complete_predictions: complete.length,
    errored_predictions: errored.length,
    total_model_calls: modelCalls,
    retries,
    parse_failures_after_retry: allPredictions.filter((r) => r.error === "PARSE_FAILURE_AFTER_RETRY").length,
    total_cost_usd: totalCostUsd,
    run_wall_clock_ms: runDurationMs,
    latency_ms: {
      mean: latencies.reduce((s, v) => s + v, 0) / Math.max(1, latencies.length),
      median: percentile(latencies, 50),
      p95: percentile(latencies, 95),
    },
    historical_search_calls: searchedCount,
    fraction_dev_items_searched: complete.length > 0 ? searchedCount / complete.length : 0,
    web_search_requests_total: webSearchTotal,
    web_fetch_requests_total: webFetchTotal,
    subagents_spawned_total: subagentsTotal,
    aggregate_model_usage: aggregateModelUsage,
  };

  mkdirSync(RECOVERY_DIR, { recursive: true });
  writeFileSync(USAGE_PATH, JSON.stringify(usage, null, 2) + "\n", "utf8");

  const delta =
    evalResult != null
      ? {
          basis:
            "DEV-tuned cross-session comparison. A3_v2 produced this session (E4) with the post-fix search-decision logic; " +
            "A0 is the SESSION E2 canonical complete result (66/66); A3_pre-fix is the SESSION E3R canonical complete result (66/66). " +
            "Neither delta is a single-route causal estimate.",
          a3_v2_macro_f1: evalResult.macroF1,
          a3_v2_accuracy: evalResult.accuracy,
          e2_a0_macro_f1: E2_A0_CANONICAL_MACRO_F1,
          e2_a0_accuracy: E2_A0_CANONICAL_ACCURACY,
          e3r_prefix_a3_macro_f1: E3R_PREFIX_A3_MACRO_F1,
          e3r_prefix_a3_accuracy: E3R_PREFIX_A3_ACCURACY,
          "A3_v2-A0_macro_f1": evalResult.macroF1 - E2_A0_CANONICAL_MACRO_F1,
          "A3_v2-A0_accuracy": evalResult.accuracy - E2_A0_CANONICAL_ACCURACY,
          "A3_v2-A3_pre_fix_macro_f1": evalResult.macroF1 - E3R_PREFIX_A3_MACRO_F1,
          "A3_v2-A3_pre_fix_accuracy": evalResult.accuracy - E3R_PREFIX_A3_ACCURACY,
        }
      : null;

  let gate: "DEV_ITERATION_IMPROVED" | "DEV_ITERATION_NO_GAIN" | "BLOCKED";
  if (!allComplete) {
    gate = "BLOCKED";
  } else if (evalResult!.macroF1 - E3R_PREFIX_A3_MACRO_F1 > 0) {
    gate = "DEV_ITERATION_IMPROVED";
  } else {
    gate = "DEV_ITERATION_NO_GAIN";
  }

  writeFileSync(
    METRICS_PATH,
    JSON.stringify(
      {
        split: "DEV",
        condition: CONDITION,
        dev_item_count: 66,
        complete_predictions: complete.length,
        errored_predictions: errored.length,
        all_66_valid: allComplete,
        result: evalResult,
        historical_search_calls: searchedCount,
        fraction_dev_items_searched: usage.fraction_dev_items_searched,
        dev_tuned_cross_session_delta: delta,
        gate,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  writeFileSync(
    CONFIG_PATH,
    JSON.stringify(
      {
        session: "SESSION E4 — BOUNDED TOOL-SEARCH RECOVERY (A3 DEV rerun)",
        condition: CONDITION,
        gate,
        note:
          "A3-only DEV tuning rerun. Only production change vs E3R: src/rulebook/toolHeuristicAdapter.ts search-decision logic. " +
          "A0/A1/A2 NOT rerun. FINAL_HOLDOUT untouched. E3R artifacts under reports/dev_bakeoff/a3_recovery/ preserved as the pre-fix diagnostic.",
        model_route: {
          route: "claude-code-cli (`claude -p`)",
          requested_model: CLAUDE_CLI_MODEL,
          cli_version: cliVersion,
          output_format: "json",
          isolation_flags: CLAUDE_CLI_ISOLATION_FLAGS,
          neutral_cwd: neutralCliCwd(),
          prompt_delivery: "stdin (no positional prompt argv)",
          prompt_template_version_hash: promptTemplateHash(),
          output_parser:
            "exact-match after trim against {RESOLVED_COMPLETED, RESOLVED_NO_NEW_WORK}; one retry on parser failure only; one retry on transport failure only; never retried due to label content",
          concurrency: CONCURRENCY,
          isolation: "one fresh process/session per prediction; no --resume/--continue ever used",
          retry_policy: "single retry per prediction on transport OR parser failure",
        },
        frozen_invariants: {
          MAX_ACTIVE_RULES,
          real_v3_active_rules_count: bundle.activeRulesCount,
          DEV_HISTORICAL_SEARCH_TOP_K,
          dev_item_count: 66,
          prompt_template_hash_sha256: promptTemplateHash(),
          v3_rulebook_hash_sha256: v3Hash,
          train_historical_corpus_hash_sha256: trainCorpusHash,
          retrieval_top_k: DEV_HISTORICAL_SEARCH_TOP_K,
          rulebook_backed_tool_heuristic_hooks: true,
        },
        dev_ground_truth: {
          expected_count: 66,
          expected_private_artifact_sha256: "87ca7ce7dfc7f722d85b67a6a864427815211a5bb04c3c92f12abe7c53524c41",
          scoring_source: "data/gate01c_manifests/manifest_dev.json (frozen, hash-verified by assertManifestsIntact)",
        },
        preflight: { status: "PASSED", ...preflight },
        circuit_breaker: { tripped: false, threshold_consecutive: CIRCUIT_BREAKER_CONSECUTIVE },
        integrity: {
          web_search_requests_total: webSearchTotal,
          web_fetch_requests_total: webFetchTotal,
          subagents_spawned_total: subagentsTotal,
          memory_hashes_unchanged: memoryUnchangedOverall,
          memory_hashes_before: memoryBefore,
          memory_hashes_after: memoryAfterRun,
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  // ---- markdown report ----
  const md: string[] = [];
  md.push("# SESSION E4 — Bounded Tool-Search Recovery (A3 DEV rerun)");
  md.push("");
  md.push(`## Gate classification: \`${gate}\``);
  md.push("");
  md.push(
    "A3-only DEV tuning rerun over all 66 DEV items. The **only** production change relative to SESSION E3R is the " +
      "Rulebook → `ToolHeuristicHooks` search-decision logic (`src/rulebook/toolHeuristicAdapter.ts`). Model, prompt " +
      "template, output schema, V3 Rulebook contents/hash, TRAIN data, retrieval top-k, ranking, and temporal filtering are " +
      "byte-for-byte the frozen E2/E3R values. A0/A1/A2 were **not** rerun. FINAL_HOLDOUT was **not** touched. The E3R " +
      "artifacts under `reports/dev_bakeoff/a3_recovery/` are preserved as the pre-fix diagnostic; this run writes only " +
      "under `reports/dev_bakeoff/a3_recovery_v2/`.",
  );
  md.push("");
  md.push("## Root cause of SEARCH=0/66 (E3R)");
  md.push("");
  md.push(
    "The frozen V3 Rulebook is 12 single-feature *marginal* rules that together cover **every** value of **every** " +
      "abstracted feature (authorAssociation, bodyLengthBucket, titleLengthBucket, hasQuestionMark, hasCodeBlock), each " +
      "recommending `RESOLVED_COMPLETED` with confidence 0.81–0.90 — i.e. each rule's confidence merely tracks the " +
      "~0.854 dominant-class frequency implied by TRAIN support (176/206). The pre-fix `shouldSearch` skipped search whenever " +
      "*any* matching rule had confidence ≥ 0.80 over ≥ 3 support. With total feature coverage that condition held for " +
      "100% of inputs, so `HIGH_CONFIDENCE_SUFFICIENT` fired for every DEV item and the retrieval path was never exercised.",
  );
  md.push("");
  md.push("## The bounded fix");
  md.push("");
  md.push(
    "`createRulebookToolHeuristics` now suppresses a historical search only when a *single* matching rule is decisively " +
      "better than the base rate its own TRAIN evidence implies: it must halve the residual base-rate error " +
      "(`confidence ≥ 1 - (1 - p0)/2`, where `p0` is the dominant-class frequency derived from the Rulebook's own " +
      "single-feature partition support — never from DEV/FINAL truth), stay above the absolute 0.80 floor, and have the " +
      "matching rules in agreement. No applicable rule, contradictory matches, or a rule whose confidence only reflects the " +
      "class prior all now permit search. Thresholds use only Rule evidence fields already present in the frozen snapshot.",
  );
  md.push("");
  md.push("## Coverage");
  md.push("");
  md.push("| Condition | Present | Expected | Complete | Errored |");
  md.push("|---|---|---|---|---|");
  md.push(`| A3_v2 | ${allPredictions.length} | 66 | ${complete.length} | ${errored.length} |`);
  md.push("");
  if (evalResult) {
    md.push("## A3_v2 metrics (DEV, 66/66 valid)");
    md.push("");
    md.push("| metric | value |");
    md.push("|---|---|");
    md.push(`| macro-F1 | ${evalResult.macroF1.toFixed(4)} |`);
    md.push(`| accuracy | ${evalResult.accuracy.toFixed(4)} |`);
    md.push(`| scored | ${evalResult.scored} |`);
    md.push(`| errored | ${evalResult.errored} |`);
    md.push("");
    md.push("### Per-class");
    md.push("");
    md.push("| label | support | precision | recall | F1 |");
    md.push("|---|---|---|---|---|");
    for (const c of evalResult.perClass) {
      md.push(`| ${c.label} | ${c.support} | ${c.precision.toFixed(4)} | ${c.recall.toFixed(4)} | ${c.f1.toFixed(4)} |`);
    }
    md.push("");
    md.push("### Confusion matrix (rows = truth, cols = predicted)");
    md.push("");
    md.push(`| | ${evalResult.confusionMatrix.labels.join(" | ")} |`);
    md.push(`|---|${evalResult.confusionMatrix.labels.map(() => "---").join("|")}|`);
    evalResult.confusionMatrix.matrix.forEach((row, i) => {
      md.push(`| ${evalResult!.confusionMatrix.labels[i]} | ${row.join(" | ")} |`);
    });
    md.push("");
    md.push("## DEV-tuned cross-session comparison");
    md.push("");
    md.push(
      "> **DEV-tuned, cross-session.** `A3_v2` was produced this session (E4). `A0` is the SESSION E2 canonical complete " +
        "result (66/66). `A3_pre-fix` is the SESSION E3R canonical complete result (66/66). Neither delta is a clean " +
        "single-route causal estimate.",
    );
    md.push("");
    md.push("| | macro-F1 | accuracy |");
    md.push("|---|---|---|");
    md.push(`| A3_v2 (E4) | ${evalResult.macroF1.toFixed(4)} | ${evalResult.accuracy.toFixed(4)} |`);
    md.push(`| A3_pre-fix (E3R) | ${E3R_PREFIX_A3_MACRO_F1.toFixed(4)} | ${E3R_PREFIX_A3_ACCURACY.toFixed(4)} |`);
    md.push(`| A0 (E2 canonical) | ${E2_A0_CANONICAL_MACRO_F1.toFixed(4)} | ${E2_A0_CANONICAL_ACCURACY.toFixed(4)} |`);
    md.push(
      `| **A3_v2 − A3_pre-fix** | **${fmtDelta(evalResult.macroF1 - E3R_PREFIX_A3_MACRO_F1)}** | ${fmtDelta(evalResult.accuracy - E3R_PREFIX_A3_ACCURACY)} |`,
    );
    md.push(
      `| **A3_v2 − A0** | **${fmtDelta(evalResult.macroF1 - E2_A0_CANONICAL_MACRO_F1)}** | ${fmtDelta(evalResult.accuracy - E2_A0_CANONICAL_ACCURACY)} |`,
    );
    md.push("");
  } else {
    md.push("## A3_v2 metrics");
    md.push("");
    md.push(`Not computed: only ${complete.length}/66 A3_v2 predictions are valid. Metrics require 66/66.`);
    md.push("");
  }
  md.push("## Tool-search behaviour");
  md.push("");
  md.push(`- historical-search calls (A3 heuristic-gated): ${searchedCount}`);
  md.push(`- fraction of DEV items that searched: ${(usage.fraction_dev_items_searched * 100).toFixed(1)}% (${searchedCount}/${complete.length})`);
  md.push(`- pre-fix (E3R) historical-search calls: 0/66`);
  md.push("");
  md.push("## Cost / tokens / latency (actual, from CLI metadata)");
  md.push("");
  md.push(`- total model calls: ${modelCalls}`);
  md.push(`- total cost (USD): ${totalCostUsd.toFixed(4)}`);
  md.push(`- retries: ${retries}`);
  md.push(`- latency ms mean/median/p95: ${usage.latency_ms.mean.toFixed(0)} / ${usage.latency_ms.median} / ${usage.latency_ms.p95}`);
  md.push(`- run wall clock: ${(runDurationMs / 1000).toFixed(1)}s at concurrency ${CONCURRENCY}`);
  md.push("");
  md.push("### aggregate modelUsage");
  md.push("");
  md.push("| model | calls | inputTokens | outputTokens | cacheRead | cacheCreation | costUSD |");
  md.push("|---|---|---|---|---|---|---|");
  for (const [model, u] of Object.entries(aggregateModelUsage)) {
    md.push(`| ${model} | ${u.calls} | ${u.inputTokens} | ${u.outputTokens} | ${u.cacheReadInputTokens} | ${u.cacheCreationInputTokens} | ${u.costUSD.toFixed(4)} |`);
  }
  md.push("");
  md.push("## Integrity");
  md.push("");
  md.push(`- web_search_requests_total: ${webSearchTotal}`);
  md.push(`- web_fetch_requests_total: ${webFetchTotal}`);
  md.push(`- subagents_spawned_total: ${subagentsTotal}`);
  md.push(`- memory V0–V3 hashes unchanged: ${memoryUnchangedOverall}`);
  md.push(`- prompt template hash: \`${promptTemplateHash()}\` (frozen E2/E3R value)`);
  md.push(`- V3 rulebook hash: \`${v3Hash}\` (frozen E2/E3R value)`);
  md.push(`- TRAIN corpus hash: \`${trainCorpusHash}\` (frozen E2/E3R value)`);
  md.push(`- FINAL_HOLDOUT: never read, scored, materialized, inferred, or fetched this session`);
  md.push("");
  writeFileSync(REPORT_MD_PATH, md.join("\n") + "\n", "utf8");

  console.log("\n=== SESSION E4 A3 DEV rerun complete ===");
  console.log(`  gate: ${gate}`);
  console.log(`  complete A3_v2 predictions: ${complete.length}/66`);
  if (evalResult) {
    console.log(`  A3_v2 macro-F1=${evalResult.macroF1.toFixed(4)} acc=${evalResult.accuracy.toFixed(4)}`);
    console.log(`  A3_v2 - A3_pre-fix macro-F1: ${fmtDelta(evalResult.macroF1 - E3R_PREFIX_A3_MACRO_F1)}`);
    console.log(`  A3_v2 - A0 macro-F1: ${fmtDelta(evalResult.macroF1 - E2_A0_CANONICAL_MACRO_F1)}`);
  }
  console.log(`  historical-search calls: ${searchedCount}/${complete.length}`);
  console.log(`  total cost: $${totalCostUsd.toFixed(4)}`);
  console.log(`  memory hashes unchanged: ${memoryUnchangedOverall}`);

  if (!allComplete) process.exitCode = 1;
}

function fmtDelta(x: number): string {
  return (x >= 0 ? "+" : "") + x.toFixed(4);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
