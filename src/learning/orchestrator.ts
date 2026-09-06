import path from "node:path";
import type { PredictorInput, ResolutionDisposition } from "../contracts/types.js";
import { Rulebook } from "../rulebook/rulebook.js";
import { writeSnapshotFile } from "../rulebook/snapshot.js";
import type { CompressionMetrics, SnapshotVersion } from "../rulebook/types.js";
import type { PolicyAgent } from "./policyAgent.js";
import { Reflector, type RevealedExample } from "./reflector.js";

/** A single TRAIN-only labeled example. There is no `split` field here by
 * construction — this type can only ever represent TRAIN data, so a caller
 * cannot accidentally feed DEV/FINAL_HOLDOUT records into the learning loop
 * through this entry point. (Reflector.reflect() additionally enforces the
 * TRAIN-only guard at runtime for anything that does carry an explicit split.) */
export interface TrainExample {
  readonly number: number;
  readonly input: PredictorInput;
  readonly actual: ResolutionDisposition;
}

export interface RoundReport {
  /** 0 = the initial snapshot frozen before any training round runs. */
  readonly round: number;
  readonly metrics: CompressionMetrics;
}

export interface LearningRunResult {
  readonly rulebook: Rulebook;
  readonly rounds: readonly RoundReport[];
  /** Absolute paths written, in order (empty if persist=false). */
  readonly snapshotsWritten: readonly string[];
}

export interface RunLearningLoopParams {
  /** Exactly 3 TRAIN batches — one per learning round. */
  readonly trainRounds: readonly (readonly TrainExample[])[];
  /** Reused, unmodified, across all 3 rounds — see PolicyAgent's doc comment on why this matters. */
  readonly policyAgent: PolicyAgent;
  readonly memoryDir?: string;
  /** Set false in tests to exercise the loop without touching disk. Defaults to true. */
  readonly persist?: boolean;
}

const ROUND_VERSIONS: readonly SnapshotVersion[] = ["V1", "V2", "V3"];

/**
 * Runs the full 3-round learning loop:
 *   TRAIN batch -> predict -> reveal TRAIN feedback -> reflect ->
 *   propose memory delta -> consolidate -> freeze snapshot
 * A V0 snapshot (empty rulebook) is frozen before round 1 starts. Persists
 * memory/V0.json..V3.json when `persist` is true (default). This function
 * never reads or references DEV/FINAL_HOLDOUT in any way — it only ever
 * sees whatever TRAIN batches the caller passes in.
 */
export function runLearningLoop(params: RunLearningLoopParams): LearningRunResult {
  if (params.trainRounds.length !== 3) {
    throw new Error(`3-round learning orchestration requires exactly 3 TRAIN batches, got ${params.trainRounds.length}`);
  }
  const memoryDir = params.memoryDir ?? path.resolve(process.cwd(), "memory");
  const persist = params.persist ?? true;

  const rulebook = new Rulebook();
  const reflector = new Reflector();
  const rounds: RoundReport[] = [];
  const snapshotsWritten: string[] = [];
  let cumulativeExamplesSeen = 0;

  const freezeSnapshot = (version: SnapshotVersion, round: number, metrics: CompressionMetrics): void => {
    if (persist) {
      const file = writeSnapshotFile(memoryDir, rulebook.toVersionSnapshot(version, round, metrics));
      snapshotsWritten.push(file);
    }
    rounds.push({ round, metrics });
  };

  // V0: frozen before any TRAIN batch is seen.
  freezeSnapshot("V0", 0, rulebook.computeMetrics(0, 0));

  for (let i = 0; i < 3; i++) {
    const round = i + 1;
    const batch = params.trainRounds[i]!;

    // predict, using only the active rules that existed BEFORE this round's evidence.
    const activeBefore = rulebook.getRules("active");
    const decisions = batch.map((ex) => params.policyAgent.predict(ex.input, activeBefore));

    // reveal TRAIN feedback (the fixture/materialized batch already carries `actual`; this is the "reveal" step conceptually).
    const revealed: RevealedExample[] = batch.map((ex, idx) => ({
      number: ex.number,
      split: "TRAIN",
      input: ex.input,
      predicted: decisions[idx]!.predicted,
      actual: ex.actual,
    }));

    // reflect -> propose memory delta
    const delta = reflector.reflect(round, revealed, activeBefore);

    // apply delta
    for (const record of delta.outcomeRecords) {
      rulebook.recordOutcome(record.ruleId, round, record.success);
    }
    for (const proposal of delta.proposals) {
      rulebook.proposeCandidate(round, proposal);
    }

    // consolidate: dedupe/merge, promote, contradictions, retirement, budget enforcement
    rulebook.consolidate(round);

    cumulativeExamplesSeen += batch.length;
    freezeSnapshot(ROUND_VERSIONS[i]!, round, rulebook.computeMetrics(round, cumulativeExamplesSeen));
  }

  return { rulebook, rounds, snapshotsWritten };
}
