import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PolicyRule, RulebookSnapshot } from "../contracts/types.js";
import type { Rule, RuleCondition, RuleProvenance, RulebookVersionSnapshot } from "./types.js";

/**
 * On-disk shapes (memory/V*.json). snake_case, mirroring the field naming
 * used elsewhere in this repo's committed manifests (see
 * src/data/manifests.ts RawManifestRecord.created_at) and the literal field
 * list from the session brief.
 */
interface DiskRule {
  readonly id: string;
  readonly type: string;
  readonly conditions: readonly RuleCondition[];
  readonly recommended_behavior: string;
  readonly confidence: number;
  readonly support_count: number;
  readonly success_count: number;
  readonly failure_count: number;
  readonly contradiction_count: number;
  readonly created_round: number;
  readonly updated_round: number;
  readonly status: string;
}

interface DiskProvenance {
  readonly created_from_round: number;
  readonly evidence_example_count: number;
  readonly source_rule_ids: readonly string[];
  readonly note?: string;
}

interface DiskMetrics {
  readonly examples_seen: number;
  readonly candidate_rules: number;
  readonly active_rules: number;
  readonly retired_rules: number;
  readonly contradictions: number;
  readonly compression_ratio: number;
}

export interface DiskSnapshot {
  readonly version: string;
  readonly round: number;
  readonly rules: readonly DiskRule[];
  readonly provenance: Readonly<Record<string, DiskProvenance>>;
  readonly metrics: DiskMetrics;
}

function toDiskRule(r: Rule): DiskRule {
  return {
    id: r.id,
    type: r.type,
    conditions: r.conditions,
    recommended_behavior: r.recommendedBehavior,
    confidence: r.confidence,
    support_count: r.supportCount,
    success_count: r.successCount,
    failure_count: r.failureCount,
    contradiction_count: r.contradictionCount,
    created_round: r.createdRound,
    updated_round: r.updatedRound,
    status: r.status,
  };
}

function toDiskProvenance(p: RuleProvenance): DiskProvenance {
  return {
    created_from_round: p.createdFromRound,
    evidence_example_count: p.evidenceExampleCount,
    source_rule_ids: p.sourceRuleIds,
    ...(p.note !== undefined ? { note: p.note } : {}),
  };
}

/** Converts an in-memory (camelCase) RulebookVersionSnapshot to its committed on-disk (snake_case) form. */
export function toDiskSnapshot(snapshot: RulebookVersionSnapshot): DiskSnapshot {
  const provenance: Record<string, DiskProvenance> = {};
  for (const [id, p] of Object.entries(snapshot.provenance)) {
    provenance[id] = toDiskProvenance(p);
  }
  return {
    version: snapshot.version,
    round: snapshot.round,
    rules: snapshot.rules.map(toDiskRule),
    provenance,
    metrics: {
      examples_seen: snapshot.metrics.examplesSeen,
      candidate_rules: snapshot.metrics.candidateRules,
      active_rules: snapshot.metrics.activeRules,
      retired_rules: snapshot.metrics.retiredRules,
      contradictions: snapshot.metrics.contradictions,
      compression_ratio: snapshot.metrics.compressionRatio,
    },
  };
}

/** Writes a version snapshot to `<dir>/<version>.json`, creating `dir` if needed. Returns the absolute path written. */
export function writeSnapshotFile(dir: string, snapshot: RulebookVersionSnapshot): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${snapshot.version}.json`);
  writeFileSync(file, `${JSON.stringify(toDiskSnapshot(snapshot), null, 2)}\n`, "utf8");
  return file;
}

function describeConditions(conditions: readonly RuleCondition[]): string {
  return conditions
    .map((c) => `${c.feature} ${c.operator}${c.value !== undefined ? ` ${String(c.value)}` : ""}`)
    .join(" AND ");
}

/**
 * Projects the ACTIVE subset of a rich Rule[] down to the frozen, minimal
 * contracts.RulebookSnapshot shape consumed by the A2 scrambled-rulebook
 * baseline (src/eval/harness.ts makeA2Predictor). Only active rules are
 * exposed — candidate/contradicted/retired rules are internal memory-engine
 * state, never a predictor input.
 */
export function toPolicyRulebookSnapshot(rules: readonly Rule[]): RulebookSnapshot {
  const active = rules.filter((r) => r.status === "active");
  const policyRules: PolicyRule[] = active.map((r) => ({
    id: r.id,
    recommendedBehavior: r.recommendedBehavior,
    rationale: describeConditions(r.conditions),
  }));
  return { version: "V3", rules: policyRules };
}
