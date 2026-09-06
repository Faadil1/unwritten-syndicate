import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadGroundTruth } from "../src/data/manifests.js";
import { loadPredictorInputs } from "../src/data/predictorInput.js";
import { loadDevEvalHistoricalCorpus, HistoricalRecordStore } from "../src/data/historicalRecords.js";
import { readSnapshotFile, toPolicyRulebookSnapshot, describeConditions } from "../src/rulebook/snapshot.js";
import { createRulebookToolHeuristics } from "../src/rulebook/toolHeuristicAdapter.js";
import { DEV_HISTORICAL_SEARCH_TOP_K } from "../src/eval/retrievalConfig.js";
import { makeA1Predictor, makeA2Predictor, makeA3Predictor, type Predictor } from "../src/eval/harness.js";
import { evaluate } from "../src/eval/metrics.js";
import { scrambleRulebook } from "../src/eval/permutation.js";
import type { EvaluationResult, GroundTruth, PredictorInput, Prediction, ResolutionDisposition } from "../src/contracts/types.js";
import type { ToolHeuristicHooks } from "../src/tools/toolHeuristics.js";
import { buildPrompt, promptTemplateHash, type PromptRuleView } from "../src/model/promptTemplate.js";
import { predictWithCli, type PredictWithCliResult } from "../src/model/predict.js";
import { CLAUDE_CLI_MODEL, CLAUDE_CLI_ISOLATION_FLAGS, neutralCliCwd, ClaudeCliIntegrityViolation } from "../src/model/claudeCli.js";

const CONDITIONS = ["A0", "A1", "A2", "A3"] as const;
type Condition = (typeof CONDITIONS)[number];

const CONCURRENCY = 4;
const A2_SCRAMBLE_SEED = "eval-dev-bakeoff-v1"; // fixed seed already frozen by Session D's plumbing (scripts/eval-dev-bakeoff.ts)
const SMOKE_ITEM_COUNT = 2;

const REPORT_DIR = path.resolve("reports", "dev_bakeoff");
const PREDICTIONS_PATH = path.join(REPORT_DIR, "predictions.jsonl");
const CONFIG_PATH = path.join(REPORT_DIR, "config.json");
const METRICS_PATH = path.join(REPORT_DIR, "metrics.json");
const USAGE_PATH = path.join(REPORT_DIR, "usage.json");
const REPORT_MD_PATH = path.join(REPORT_DIR, "DEV_BAKEOFF_REPORT.md");

const MEMORY_DIR = path.resolve("memory");
const MEMORY_VERSIONS = ["V0", "V1", "V2", "V3"] as const;

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
  readonly condition: Condition;
  readonly number: number;
  readonly predicted: ResolutionDisposition;
  readonly error?: string;
  readonly retried: boolean;
  readonly latencyMs: number;
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

function isCondition(v: unknown): v is Condition {
  return typeof v === "string" && (CONDITIONS as readonly string[]).includes(v);
}

/**
 * Reads predictions.jsonl, discarding any line that is not a real
 * (condition, number) prediction record from this run — specifically the
 * single legacy `{"status":"BLOCKED",...}` bookkeeping line a prior,
 * pre-model-route session left in this file. That line predates this
 * script's schema and must never be miscounted as a resumed prediction or
 * passed to per-condition scoring.
 */
function loadExistingPredictions(): PredictionRecord[] {
  if (!existsSync(PREDICTIONS_PATH)) return [];
  return readFileSync(PREDICTIONS_PATH, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as PredictionRecord)
    .filter((r) => isCondition(r.condition) && typeof r.number === "number");
}

function appendPrediction(record: PredictionRecord): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  appendFileSync(PREDICTIONS_PATH, JSON.stringify(record) + "\n", "utf8");
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

async function runPool<T>(items: readonly T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let aborted: unknown = null;
  async function worker(): Promise<void> {
    while (next < items.length && !aborted) {
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

interface PredictorSet {
  readonly predictors: Record<Condition, Predictor>;
  readonly a3SearchCounter: { count: number };
  readonly activeRulesCount: number;
  readonly scrambledRulesHash: string;
}

function buildPredictors(callMeta: WeakMap<PredictorInput, PredictWithCliResult>): PredictorSet {
  const { records: corpusRecords } = loadDevEvalHistoricalCorpus();
  const store = new HistoricalRecordStore(corpusRecords);

  const v3 = readSnapshotFile("memory", "V3");
  if (!v3.available || !v3.snapshot) {
    throw new Error("memory/V3.json not present — run `npm run learn:train` first.");
  }
  const activeRules = v3.snapshot.rules.filter((r) => r.status === "active");
  const policySnapshot = toPolicyRulebookSnapshot(v3.snapshot.rules);
  const scrambled = scrambleRulebook(policySnapshot, A2_SCRAMBLE_SEED);
  const scrambledRulesHash = createHash("sha256").update(JSON.stringify(scrambled)).digest("hex");

  const activeRulesView: PromptRuleView[] = activeRules.map((r) => ({
    id: r.id,
    recommendedBehavior: r.recommendedBehavior,
    rationale: `${describeConditions(r.conditions)} (confidence ${r.confidence.toFixed(2)}, support ${r.supportCount})`,
  }));

  async function callModel(input: PredictorInput, extras: Parameters<typeof buildPrompt>[1]): Promise<ResolutionDisposition> {
    const prompt = buildPrompt(input, extras);
    const res = await predictWithCli(prompt);
    callMeta.set(input, res);
    return res.disposition;
  }

  const a0 = (input: PredictorInput) => callModel(input, {});
  const a1 = makeA1Predictor(store, DEV_HISTORICAL_SEARCH_TOP_K, (input, history) => callModel(input, { history }));
  const a2 = makeA2Predictor(policySnapshot, A2_SCRAMBLE_SEED, (input, scrambledSnapshot) => callModel(input, { rules: scrambledSnapshot.rules }));

  const a3SearchCounter = { count: 0 };
  const baseHeuristics = createRulebookToolHeuristics(activeRules);
  const countingHeuristics: ToolHeuristicHooks = {
    ...baseHeuristics,
    shouldSearch: (ctx) => {
      const d = baseHeuristics.shouldSearch(ctx);
      if (d.action === "SEARCH") a3SearchCounter.count += 1;
      return d;
    },
  };
  const a3 = makeA3Predictor(store, DEV_HISTORICAL_SEARCH_TOP_K, activeRules, countingHeuristics, (input, _rules, history) =>
    callModel(input, { rules: activeRulesView, history }),
  );

  return {
    predictors: { A0: a0, A1: a1, A2: a2, A3: a3 },
    a3SearchCounter,
    activeRulesCount: activeRules.length,
    scrambledRulesHash,
  };
}

interface Task {
  readonly condition: Condition;
  readonly number: number;
  readonly input: PredictorInput;
}

async function runTask(
  task: Task,
  predictorSet: PredictorSet,
  callMeta: WeakMap<PredictorInput, PredictWithCliResult>,
): Promise<PredictionRecord> {
  const fn = predictorSet.predictors[task.condition];
  try {
    const disposition = await fn(task.input);
    const res = callMeta.get(task.input);
    callMeta.delete(task.input);
    if (!res) throw new Error("internal: no CLI call metadata captured for this prediction");
    return {
      condition: task.condition,
      number: task.number,
      predicted: disposition,
      ...(res.parseFailureAfterRetry ? { error: "PARSE_FAILURE_AFTER_RETRY" } : {}),
      retried: res.retried,
      latencyMs: res.calls.reduce((s, c) => s + c.latencyMs, 0),
      calls: res.calls.map(toCallRecord),
    };
  } catch (err) {
    if (err instanceof ClaudeCliIntegrityViolation) throw err;
    return {
      condition: task.condition,
      number: task.number,
      predicted: "RESOLVED_COMPLETED",
      error: err instanceof Error ? err.message : String(err),
      retried: false,
      latencyMs: 0,
      calls: [],
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.log("=== SESSION E2 — real-model DEV A0/A1/A2/A3 bakeoff (Claude Code CLI route) ===");

  const cliVersion = execFileSync("claude", ["--version"], { encoding: "utf8", shell: true }).trim();
  console.log(`claude CLI version: ${cliVersion}`);

  const memoryBefore = memoryHashes();

  const { available: devAvailable, records, extraNumbers, missingNumbers } = loadPredictorInputs("DEV");
  if (!devAvailable) throw new Error("data/dev.jsonl not materialized.");
  if (extraNumbers.length > 0 || missingNumbers.length > 0) {
    throw new Error(`DEV issue-number set mismatch. extra=${extraNumbers.join(",")} missing=${missingNumbers.join(",")}`);
  }
  if (records.length !== 66) throw new Error(`expected exactly 66 DEV records, found ${records.length}`);

  const groundTruth = loadGroundTruth("DEV");
  const items = [...records].sort((a, b) => a.number - b.number).map((r) => ({ number: r.number, input: r.input }));

  const trainFeedbackHash = sha256File(path.resolve("data", "train_feedback.jsonl"));
  const v3Hash = sha256File(path.resolve("memory", "V3.json"));

  const callMeta = new WeakMap<PredictorInput, PredictWithCliResult>();
  const predictorSet = buildPredictors(callMeta);

  // ---------- SMOKE GATE ----------
  console.log(`\n--- smoke gate: ${SMOKE_ITEM_COUNT} DEV item(s) x ${CONDITIONS.length} conditions ---`);
  const smokeItems = items.slice(0, SMOKE_ITEM_COUNT);
  const smokeResults: { condition: Condition; number: number; ok: boolean; detail: string; latencyMs: number; costUsd: number }[] = [];
  let smokeFailed = false;
  for (const condition of CONDITIONS) {
    for (const item of smokeItems) {
      try {
        const fn = predictorSet.predictors[condition];
        const disposition = await fn(item.input);
        const res = callMeta.get(item.input);
        callMeta.delete(item.input);
        const cost = res ? res.calls.reduce((s, c) => s + c.totalCostUsd, 0) : 0;
        const latency = res ? res.calls.reduce((s, c) => s + c.latencyMs, 0) : 0;
        const ok = !!res && !res.parseFailureAfterRetry;
        smokeResults.push({ condition, number: item.number, ok, detail: disposition, latencyMs: latency, costUsd: cost });
        console.log(`  [smoke ${condition} #${item.number}] ${ok ? "OK" : "PARSE_FAILURE"} -> ${disposition} (${latency}ms, $${cost.toFixed(4)})`);
        if (!ok) smokeFailed = true;
      } catch (err) {
        smokeFailed = true;
        const msg = err instanceof Error ? err.message : String(err);
        smokeResults.push({ condition, number: item.number, ok: false, detail: msg, latencyMs: 0, costUsd: 0 });
        console.error(`  [smoke ${condition} #${item.number}] FAILED: ${msg}`);
      }
    }
  }

  const memoryAfterSmoke = memoryHashes();
  const memoryUnchangedAfterSmoke = hashesEqual(memoryBefore, memoryAfterSmoke);
  if (!memoryUnchangedAfterSmoke) smokeFailed = true;

  const smokeCallCount = smokeResults.length;
  const smokeAvgCost = smokeResults.reduce((s, r) => s + r.costUsd, 0) / Math.max(1, smokeCallCount);
  const smokeAvgLatency = smokeResults.reduce((s, r) => s + r.latencyMs, 0) / Math.max(1, smokeCallCount);
  const totalPredictions = items.length * CONDITIONS.length;
  const estimatedFullCostUsd = smokeAvgCost * totalPredictions;
  const estimatedFullWallClockMs = (smokeAvgLatency * totalPredictions) / CONCURRENCY;

  console.log(`\nsmoke gate: ${smokeFailed ? "FAILED" : "PASSED"}`);
  console.log(`  memory hashes unchanged: ${memoryUnchangedAfterSmoke}`);
  console.log(`  estimated full-run cost: $${estimatedFullCostUsd.toFixed(2)} over ${totalPredictions} predictions`);
  console.log(`  estimated full-run wall clock: ~${Math.round(estimatedFullWallClockMs / 1000)}s at concurrency ${CONCURRENCY}`);

  mkdirSync(REPORT_DIR, { recursive: true });

  if (smokeFailed) {
    writeFileSync(
      CONFIG_PATH,
      JSON.stringify(
        {
          session: "SESSION E2 — REAL MODEL DEV BAKEOFF (A0/A1/A2/A3)",
          gate: "BLOCKED",
          blocker_code: "SMOKE_GATE_FAILED",
          smoke_results: smokeResults,
          memory_hashes_before: memoryBefore,
          memory_hashes_after_smoke: memoryAfterSmoke,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    throw new Error("Smoke gate failed integrity checks. STOPPING before full run.");
  }

  // ---------- FULL RUN ----------
  console.log(`\n--- full run: ${items.length} DEV items x ${CONDITIONS.length} conditions = ${totalPredictions} predictions ---`);
  const existing = loadExistingPredictions();
  const done = new Set(existing.map((r) => `${r.condition}:${r.number}`));
  console.log(`  resuming: ${done.size}/${totalPredictions} predictions already recorded`);

  const allTasks: Task[] = [];
  for (const condition of CONDITIONS) {
    for (const item of items) {
      if (!done.has(`${condition}:${item.number}`)) allTasks.push({ condition, number: item.number, input: item.input });
    }
  }
  console.log(`  ${allTasks.length} predictions remaining to run at concurrency ${CONCURRENCY}`);

  const runStart = Date.now();
  let integrityViolation: ClaudeCliIntegrityViolation | null = null;
  try {
    await runPool(allTasks, CONCURRENCY, async (task) => {
      const record = await runTask(task, predictorSet, callMeta);
      appendPrediction(record);
      console.log(`  [${record.condition} #${record.number}] ${record.error ? `ERROR (${record.error})` : record.predicted}`);
    });
  } catch (err) {
    if (err instanceof ClaudeCliIntegrityViolation) {
      integrityViolation = err;
      await sleep(2000); // let any remaining in-flight (< concurrency) tasks finish writing
    } else {
      throw err;
    }
  }
  const runDurationMs = Date.now() - runStart;

  const memoryAfterFull = memoryHashes();
  const memoryUnchangedOverall = hashesEqual(memoryBefore, memoryAfterFull);

  const allPredictions = loadExistingPredictions();

  if (integrityViolation) {
    writeFileSync(
      CONFIG_PATH,
      JSON.stringify(
        {
          session: "SESSION E2 — REAL MODEL DEV BAKEOFF (A0/A1/A2/A3)",
          gate: "INVALID",
          blocker_code: "TOOL_USE_INTEGRITY_VIOLATION",
          detail: integrityViolation.message,
          envelope: integrityViolation.envelope,
          predictions_recorded_before_abort: allPredictions.length,
          memory_hashes_unchanged: memoryUnchangedOverall,
        },
        null,
        2,
      ) + "\n",
      "utf8",
    );
    throw new Error(`INVALID: ${integrityViolation.message}`);
  }

  // ---------- METRICS ----------
  const byCondition: Record<Condition, Prediction[]> = { A0: [], A1: [], A2: [], A3: [] };
  for (const r of allPredictions) {
    byCondition[r.condition].push({ number: r.number, predicted: r.predicted, ...(r.error ? { error: r.error } : {}) });
  }

  const results: Record<Condition, EvaluationResult> = {} as Record<Condition, EvaluationResult>;
  for (const condition of CONDITIONS) {
    results[condition] = evaluate("DEV", groundTruth, byCondition[condition]);
    console.log(
      `  [${condition}] macro-F1=${results[condition].macroF1.toFixed(4)} acc=${results[condition].accuracy.toFixed(4)} scored=${results[condition].scored} errored=${results[condition].errored}`,
    );
  }

  const deltas = {
    "A3-A0": results.A3.macroF1 - results.A0.macroF1,
    "A3-A1": results.A3.macroF1 - results.A1.macroF1,
    "A3-A2": results.A3.macroF1 - results.A2.macroF1,
    "A1-A0": results.A1.macroF1 - results.A0.macroF1,
  };

  // ---------- USAGE ----------
  const aggregateModelUsage: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; costUSD: number; calls: number }> = {};
  let totalCostUsd = 0;
  let webSearchTotal = 0;
  let webFetchTotal = 0;
  let subagentsTotal = 0;
  const perConditionUsage: Record<string, unknown> = {};
  for (const condition of CONDITIONS) {
    const recs = allPredictions.filter((r) => r.condition === condition);
    const latencies = recs.map((r) => r.latencyMs).sort((a, b) => a - b);
    const retries = recs.filter((r) => r.retried).length;
    const errors = recs.filter((r) => r.error !== undefined).length;
    let condCost = 0;
    for (const r of recs) {
      for (const c of r.calls) {
        condCost += c.totalCostUsd;
        totalCostUsd += c.totalCostUsd;
        webSearchTotal += c.webSearchRequests;
        webFetchTotal += c.webFetchRequests;
        subagentsTotal += c.subagentsSpawned;
        for (const [model, usage] of Object.entries(c.modelUsage as Record<string, Record<string, unknown>>)) {
          const agg = (aggregateModelUsage[model] ??= { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0, calls: 0 });
          agg.inputTokens += Number(usage.inputTokens ?? 0);
          agg.outputTokens += Number(usage.outputTokens ?? 0);
          agg.cacheReadInputTokens += Number(usage.cacheReadInputTokens ?? 0);
          agg.cacheCreationInputTokens += Number(usage.cacheCreationInputTokens ?? 0);
          agg.costUSD += Number(usage.costUSD ?? 0);
          agg.calls += 1;
        }
      }
    }
    perConditionUsage[condition] = {
      predictions: recs.length,
      model_calls: recs.reduce((s, r) => s + r.calls.length, 0),
      retries,
      parse_failures_after_retry: errors,
      total_cost_usd: condCost,
      latency_ms: { mean: latencies.reduce((s, v) => s + v, 0) / Math.max(1, latencies.length), median: percentile(latencies, 50), p95: percentile(latencies, 95) },
    };
  }
  perConditionUsage["A1_historical_search_calls"] = items.length; // A1 always searches, every item
  perConditionUsage["A3_historical_search_calls"] = predictorSet.a3SearchCounter.count;

  writeFileSync(
    USAGE_PATH,
    JSON.stringify(
      {
        total_predictions: allPredictions.length,
        total_model_calls: allPredictions.reduce((s, r) => s + r.calls.length, 0),
        total_cost_usd: totalCostUsd,
        web_search_requests_total: webSearchTotal,
        web_fetch_requests_total: webFetchTotal,
        subagents_spawned_total: subagentsTotal,
        run_wall_clock_ms: runDurationMs,
        aggregate_model_usage: aggregateModelUsage,
        per_condition: perConditionUsage,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  writeFileSync(
    METRICS_PATH,
    JSON.stringify(
      {
        split: "DEV",
        dev_item_count: items.length,
        results,
        deltas,
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
        session: "SESSION E2 — REAL MODEL DEV BAKEOFF (A0/A1/A2/A3)",
        gate: "COMPLETED",
        model_route: {
          route: "claude-code-cli",
          requested_model: CLAUDE_CLI_MODEL,
          cli_version: cliVersion,
          output_format: "json",
          isolation_flags: CLAUDE_CLI_ISOLATION_FLAGS,
          neutral_cwd: neutralCliCwd(),
          prompt_delivery: "stdin (no positional prompt argv, avoids shell-quoting risk)",
          prompt_template_version_hash: promptTemplateHash(),
          output_parser: "exact-match after trim against {RESOLVED_COMPLETED, RESOLVED_NO_NEW_WORK}; one retry on parse failure only, identical prompt/config; never retried due to label content",
          concurrency: CONCURRENCY,
          isolation: "one fresh process/session per prediction; no --resume/--continue ever used",
          retry_policy: "single retry, parse-failure-only",
          sampling_thinking_flags: "none set (CLI defaults; no --effort flag used)",
        },
        frozen_invariants: {
          MAX_ACTIVE_RULES: 15,
          real_v3_active_rules_count: predictorSet.activeRulesCount,
          DEV_HISTORICAL_SEARCH_TOP_K,
          dev_item_count: items.length,
          a2_scramble_seed: A2_SCRAMBLE_SEED,
          a2_scrambled_rulebook_hash: predictorSet.scrambledRulesHash,
          v3_rulebook_hash_sha256: v3Hash,
          train_historical_corpus_hash_sha256: trainFeedbackHash,
        },
        dev_ground_truth: {
          expected_count: 66,
          expected_sha256: "87ca7ce7dfc7f722d85b67a6a864427815211a5bb04c3c92f12abe7c53524c41",
        },
        smoke_gate: { status: "PASSED", results: smokeResults, estimated_full_cost_usd: estimatedFullCostUsd, estimated_full_wall_clock_ms: estimatedFullWallClockMs },
        integrity: {
          web_search_requests_total: webSearchTotal,
          web_fetch_requests_total: webFetchTotal,
          subagents_spawned_total: subagentsTotal,
          memory_hashes_unchanged: memoryUnchangedOverall,
          memory_hashes_before: memoryBefore,
          memory_hashes_after: memoryAfterFull,
        },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log("\n=== SESSION E2 run complete ===");
  console.log(`  total predictions: ${allPredictions.length}`);
  console.log(`  total cost: $${totalCostUsd.toFixed(4)}`);
  console.log(`  memory hashes unchanged: ${memoryUnchangedOverall}`);
  console.log(`  deltas: ${JSON.stringify(deltas)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
