import { conditionsOverlap, conditionsSignature, validateConditions } from "./conditions.js";
import type {
  CompressionMetrics,
  Rule,
  RuleCondition,
  RuleProvenance,
  RuleStatus,
  RuleType,
  RulebookVersionSnapshot,
  SnapshotVersion,
} from "./types.js";
import type { ResolutionDisposition } from "../contracts/types.js";

/** Hard cap on simultaneously-active rules, per the session brief. */
export const MAX_ACTIVE_RULES = 15;

/** A candidate needs at least this much evidence before it may be promoted. */
export const MIN_SUPPORT_FOR_ACTIVE = 3;
/** ...and its Laplace-smoothed confidence must clear this bar. */
export const MIN_CONFIDENCE_FOR_ACTIVE = 0.7;

/** A rule needs at least this much evidence before retirement-by-failure applies (avoids retiring on noise). */
export const RETIREMENT_MIN_SUPPORT = 3;
/** failureCount / supportCount at or above this fraction triggers retirement. */
export const RETIREMENT_FAILURE_RATE = 0.6;

/** Number of detected contradiction events before both rules are marked "contradicted". */
export const CONTRADICTION_RETIRE_THRESHOLD = 2;

export interface NewRuleProposal {
  readonly type: RuleType;
  readonly conditions: readonly RuleCondition[];
  readonly recommendedBehavior: ResolutionDisposition;
  readonly supportCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly note?: string;
}

/** Laplace-smoothed success rate — never exactly 0 or 1, so a single observation can't fully commit a rule. */
export function computeConfidence(successCount: number, failureCount: number): number {
  return (successCount + 1) / (successCount + failureCount + 2);
}

/**
 * The evidence-backed rule memory. Owns the full lifecycle:
 * candidate -> active -> {contradicted, retired}. All mutation goes through
 * this class so invariants (feature allowlist, active-rule budget) are
 * structurally impossible to bypass from the Reflector/orchestrator layer.
 */
export class Rulebook {
  private rules: Rule[] = [];
  private provenance: Record<string, RuleProvenance> = {};
  private nextId = 1;

  private allocateId(): string {
    return `rule-${this.nextId++}`;
  }

  private indexOf(id: string): number {
    const idx = this.rules.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error(`Unknown rule id "${id}"`);
    return idx;
  }

  getRules(status?: RuleStatus): readonly Rule[] {
    return status ? this.rules.filter((r) => r.status === status) : [...this.rules];
  }

  getById(id: string): Rule | undefined {
    return this.rules.find((r) => r.id === id);
  }

  private setStatus(id: string, status: RuleStatus, round: number): void {
    const idx = this.indexOf(id);
    this.rules[idx] = { ...this.rules[idx]!, status, updatedRound: round };
  }

  /**
   * Adds evidence for a proposed rule. If an existing non-retired,
   * non-contradicted rule already has the identical (conditions,
   * recommendedBehavior) pair, the evidence is merged into it instead of
   * creating a duplicate — this is the round-to-round dedupe path (within a
   * single round, `dedupeAndMerge` handles the rest).
   */
  proposeCandidate(round: number, proposal: NewRuleProposal): Rule {
    validateConditions(proposal.conditions);
    const signature = conditionsSignature(proposal.conditions);
    const existing = this.rules.find(
      (r) =>
        r.status !== "retired" &&
        r.status !== "contradicted" &&
        r.recommendedBehavior === proposal.recommendedBehavior &&
        conditionsSignature(r.conditions) === signature,
    );
    if (existing) {
      return this.mergeEvidenceInto(existing.id, proposal, round);
    }
    const id = this.allocateId();
    const rule: Rule = {
      id,
      type: proposal.type,
      conditions: proposal.conditions,
      recommendedBehavior: proposal.recommendedBehavior,
      confidence: computeConfidence(proposal.successCount, proposal.failureCount),
      supportCount: proposal.supportCount,
      successCount: proposal.successCount,
      failureCount: proposal.failureCount,
      contradictionCount: 0,
      createdRound: round,
      updatedRound: round,
      status: "candidate",
    };
    this.rules.push(rule);
    this.provenance[id] = {
      createdFromRound: round,
      evidenceExampleCount: proposal.supportCount,
      sourceRuleIds: [],
      ...(proposal.note !== undefined ? { note: proposal.note } : {}),
    };
    return rule;
  }

  private mergeEvidenceInto(id: string, proposal: NewRuleProposal, round: number): Rule {
    const idx = this.indexOf(id);
    const r = this.rules[idx]!;
    const supportCount = r.supportCount + proposal.supportCount;
    const successCount = r.successCount + proposal.successCount;
    const failureCount = r.failureCount + proposal.failureCount;
    const updated: Rule = {
      ...r,
      supportCount,
      successCount,
      failureCount,
      confidence: computeConfidence(successCount, failureCount),
      updatedRound: round,
    };
    this.rules[idx] = updated;
    const prov = this.provenance[id]!;
    this.provenance[id] = { ...prov, evidenceExampleCount: prov.evidenceExampleCount + proposal.supportCount };
    return updated;
  }

  /** Records a single observed firing outcome for an existing rule (used when an active rule fires during a TRAIN round). */
  recordOutcome(id: string, round: number, success: boolean): void {
    const idx = this.indexOf(id);
    const r = this.rules[idx]!;
    const supportCount = r.supportCount + 1;
    const successCount = r.successCount + (success ? 1 : 0);
    const failureCount = r.failureCount + (success ? 0 : 1);
    this.rules[idx] = {
      ...r,
      supportCount,
      successCount,
      failureCount,
      confidence: computeConfidence(successCount, failureCount),
      updatedRound: round,
    };
  }

  private recordContradiction(id: string, round: number): void {
    const idx = this.indexOf(id);
    const r = this.rules[idx]!;
    this.rules[idx] = { ...r, contradictionCount: r.contradictionCount + 1, updatedRound: round };
  }

  /**
   * Merges rules that ended up with identical (conditions, recommendedBehavior)
   * — e.g. two separate proposals from different rounds that both survived to
   * this consolidation. The earliest-created rule is kept as canonical; the
   * others are marked "retired" (not deleted) with their lineage recorded in
   * canonical's provenance, so the audit trail (V0..V3 snapshots) never loses
   * a rule id silently.
   */
  dedupeAndMerge(round: number): number {
    const groups = new Map<string, Rule[]>();
    for (const r of this.rules) {
      if (r.status === "retired" || r.status === "contradicted") continue;
      const key = `${conditionsSignature(r.conditions)}|${r.recommendedBehavior}`;
      const group = groups.get(key) ?? [];
      group.push(r);
      groups.set(key, group);
    }
    let merges = 0;
    for (const group of groups.values()) {
      if (group.length <= 1) continue;
      const canonical = group.reduce((a, b) => (a.createdRound <= b.createdRound ? a : b));
      const others = group.filter((r) => r.id !== canonical.id);
      const supportCount = group.reduce((s, r) => s + r.supportCount, 0);
      const successCount = group.reduce((s, r) => s + r.successCount, 0);
      const failureCount = group.reduce((s, r) => s + r.failureCount, 0);
      const canonicalIdx = this.indexOf(canonical.id);
      this.rules[canonicalIdx] = {
        ...canonical,
        supportCount,
        successCount,
        failureCount,
        confidence: computeConfidence(successCount, failureCount),
        updatedRound: round,
      };
      const canonicalProv = this.provenance[canonical.id]!;
      const absorbedIds = others.map((o) => o.id);
      this.provenance[canonical.id] = {
        ...canonicalProv,
        sourceRuleIds: [...canonicalProv.sourceRuleIds, ...absorbedIds],
      };
      for (const o of others) {
        this.setStatus(o.id, "retired", round);
        merges++;
      }
    }
    return merges;
  }

  /** candidate -> active once evidence clears the support+confidence bar. */
  promoteEligibleCandidates(round: number): number {
    let promoted = 0;
    for (const r of this.rules) {
      if (r.status === "candidate" && r.supportCount >= MIN_SUPPORT_FOR_ACTIVE && r.confidence >= MIN_CONFIDENCE_FOR_ACTIVE) {
        this.setStatus(r.id, "active", round);
        promoted++;
      }
    }
    return promoted;
  }

  /**
   * Pairwise-checks ACTIVE rules only. Two active rules whose condition
   * spaces can co-fire but which recommend opposite dispositions are a
   * policy contradiction: each occurrence increments both rules'
   * contradictionCount, and once a rule accumulates
   * CONTRADICTION_RETIRE_THRESHOLD contradiction events it is marked
   * "contradicted" (terminal, distinct from ordinary retirement).
   */
  detectContradictions(round: number): number {
    const active = this.getRules("active");
    let count = 0;
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i]!;
        const b = active[j]!;
        if (a.recommendedBehavior === b.recommendedBehavior) continue;
        if (!conditionsOverlap(a.conditions, b.conditions)) continue;
        count++;
        this.recordContradiction(a.id, round);
        this.recordContradiction(b.id, round);
        const ra = this.getById(a.id)!;
        const rb = this.getById(b.id)!;
        if (ra.contradictionCount >= CONTRADICTION_RETIRE_THRESHOLD && ra.status === "active") {
          this.setStatus(ra.id, "contradicted", round);
        }
        if (rb.contradictionCount >= CONTRADICTION_RETIRE_THRESHOLD && rb.status === "active") {
          this.setStatus(rb.id, "contradicted", round);
        }
      }
    }
    return count;
  }

  /** Retires any candidate/active rule whose evidence has accumulated enough failures to fail the reliability bar. */
  retireFailingRules(round: number): number {
    let retired = 0;
    for (const r of this.rules) {
      if (r.status !== "active" && r.status !== "candidate") continue;
      if (r.supportCount < RETIREMENT_MIN_SUPPORT) continue;
      const failureRate = r.failureCount / r.supportCount;
      if (failureRate >= RETIREMENT_FAILURE_RATE) {
        this.setStatus(r.id, "retired", round);
        retired++;
      }
    }
    return retired;
  }

  /**
   * Hard-enforces MAX_ACTIVE_RULES: if more than 15 rules are active, evicts
   * (retires) the weakest ones — ranked by confidence * supportCount
   * ascending — until exactly 15 remain. This is the only path that can
   * retire a rule purely for budget reasons rather than for failing
   * evidence, so it is kept as its own step for auditability.
   */
  enforceActiveBudget(round: number): number {
    const active = this.getRules("active");
    if (active.length <= MAX_ACTIVE_RULES) return 0;
    const ranked = [...active].sort((a, b) => a.confidence * a.supportCount - b.confidence * b.supportCount);
    const overflow = ranked.length - MAX_ACTIVE_RULES;
    for (let i = 0; i < overflow; i++) {
      this.setStatus(ranked[i]!.id, "retired", round);
    }
    return overflow;
  }

  /**
   * Runs one full consolidation pass in a fixed, documented order:
   * dedupe/merge (so accumulated evidence counts before promotion) ->
   * promote eligible candidates -> detect contradictions among the
   * resulting active set -> retire repeatedly-failing rules -> enforce the
   * active-rule budget last (so budget eviction sees the final candidate
   * active set, not a stale one).
   */
  consolidate(round: number): void {
    this.dedupeAndMerge(round);
    this.promoteEligibleCandidates(round);
    this.detectContradictions(round);
    this.retireFailingRules(round);
    this.enforceActiveBudget(round);
  }

  computeMetrics(round: number, cumulativeExamplesSeen: number): CompressionMetrics {
    const candidateRules = this.getRules("candidate").length;
    const activeRules = this.getRules("active").length;
    const retiredRules = this.getRules("retired").length + this.getRules("contradicted").length;
    const contradictions = this.rules.reduce((s, r) => s + r.contradictionCount, 0) / 2; // each event double-counted across the pair
    const compressionRatio = activeRules === 0 ? 0 : cumulativeExamplesSeen / activeRules;
    return {
      examplesSeen: cumulativeExamplesSeen,
      candidateRules,
      activeRules,
      retiredRules,
      contradictions,
      compressionRatio,
    };
  }

  toVersionSnapshot(version: SnapshotVersion, round: number, metrics: CompressionMetrics): RulebookVersionSnapshot {
    return {
      version,
      round,
      rules: this.rules.map((r) => ({ ...r })),
      provenance: { ...this.provenance },
      metrics,
    };
  }
}
