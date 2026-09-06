import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ResolutionDisposition, PolicyRule, RulebookSnapshot } from "../contracts/types.js";
import type {
  Rule,
  RuleCondition,
  RuleProvenance,
  RuleStatus,
  RuleType,
  RulebookVersionSnapshot,
  SnapshotVersion,
} from "./types.js";

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

function fromDiskRule(r: DiskRule): Rule {
  return {
    id: r.id,
    type: r.type as RuleType,
    conditions: r.conditions,
    recommendedBehavior: r.recommended_behavior as ResolutionDisposition,
    confidence: r.confidence,
    supportCount: r.support_count,
    successCount: r.success_count,
    failureCount: r.failure_count,
    contradictionCount: r.contradiction_count,
    createdRound: r.created_round,
    updatedRound: r.updated_round,
    status: r.status as RuleStatus,
  };
}

function fromDiskProvenance(p: DiskProvenance): RuleProvenance {
  return {
    createdFromRound: p.created_from_round,
    evidenceExampleCount: p.evidence_example_count,
    sourceRuleIds: p.source_rule_ids,
    ...(p.note !== undefined ? { note: p.note } : {}),
  };
}

/** Converts a committed on-disk (snake_case) snapshot back to its in-memory (camelCase) form — the exact inverse of `toDiskSnapshot`. */
export function fromDiskSnapshot(disk: DiskSnapshot): RulebookVersionSnapshot {
  const provenance: Record<string, RuleProvenance> = {};
  for (const [id, p] of Object.entries(disk.provenance)) {
    provenance[id] = fromDiskProvenance(p);
  }
  return {
    version: disk.version as SnapshotVersion,
    round: disk.round,
    rules: disk.rules.map(fromDiskRule),
    provenance,
    metrics: {
      examplesSeen: disk.metrics.examples_seen,
      candidateRules: disk.metrics.candidate_rules,
      activeRules: disk.metrics.active_rules,
      retiredRules: disk.metrics.retired_rules,
      contradictions: disk.metrics.contradictions,
      compressionRatio: disk.metrics.compression_ratio,
    },
  };
}

/**
 * Reads `<dir>/<version>.json` (written by `writeSnapshotFile`) back into a
 * `RulebookVersionSnapshot`. Returns `available: false` rather than
 * throwing if the file does not exist yet, mirroring this repo's existing
 * "don't fabricate a result" convention (see src/data/predictorInput.ts).
 */
export function readSnapshotFile(
  dir: string,
  version: SnapshotVersion,
): { available: boolean; snapshot?: RulebookVersionSnapshot } {
  const file = path.join(dir, `${version}.json`);
  if (!existsSync(file)) return { available: false };
  const disk = JSON.parse(readFileSync(file, "utf8")) as DiskSnapshot;
  return { available: true, snapshot: fromDiskSnapshot(disk) };
}

export function describeConditions(conditions: readonly RuleCondition[]): string {
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
