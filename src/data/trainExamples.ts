import type { AuthorAssociation, ResolutionDisposition } from "../contracts/types.js";
import { loadGroundTruth } from "./manifests.js";
import { loadPredictorInputs } from "./predictorInput.js";

/**
 * Explicit, reviewed data->learning integration point: joins the
 * materialized TRAIN predictor inputs (data/train.jsonl) against the frozen
 * TRAIN ground truth manifest, and splits the result into exactly 3
 * chronological batches for the 3-round learning loop
 * (src/learning/orchestrator.ts runLearningLoop).
 *
 * This is the ONLY place in the repository allowed to hand real TRAIN
 * labels to the learning layer. src/learning/** and src/rulebook/**
 * themselves must never import loadGroundTruth directly — that is
 * structurally enforced by tests/learning/noLeakage.test.ts, whose doc
 * comment says exactly this: "if it needs real data one day, that must go
 * through an explicit, reviewed integration point." This module, plus its
 * caller scripts/learn-train.ts (both outside src/learning and
 * src/rulebook), are that integration point. Only ever reads TRAIN — never
 * DEV or FINAL_HOLDOUT.
 */
export interface RealTrainExample {
  readonly number: number;
  readonly input: {
    readonly title: string;
    readonly body: string;
    readonly createdAt: string;
    readonly authorAssociation: AuthorAssociation;
  };
  readonly actual: ResolutionDisposition;
}

export interface RealTrainLoadResult {
  readonly available: boolean;
  readonly totalRecords: number;
  readonly rounds: readonly (readonly RealTrainExample[])[];
  readonly missingNumbers: readonly number[];
}

export function loadRealTrainRounds(): RealTrainLoadResult {
  const loaded = loadPredictorInputs("TRAIN");
  if (!loaded.available) {
    return { available: false, totalRecords: 0, rounds: [], missingNumbers: [] };
  }

  const truthByNumber = new Map(loadGroundTruth("TRAIN").map((g) => [g.number, g]));
  const examples: RealTrainExample[] = [];
  const missingNumbers: number[] = [];
  for (const rec of loaded.records) {
    const truth = truthByNumber.get(rec.number);
    if (!truth) {
      missingNumbers.push(rec.number);
      continue;
    }
    examples.push({ number: rec.number, input: rec.input, actual: truth.label });
  }

  // Chronological order, then split into 3 contiguous, nearly-equal batches —
  // deterministic and reproducible given a fixed materialized dataset, and
  // means round 1/2/3 see strictly non-overlapping, time-ordered slices of
  // TRAIN (oldest third first) rather than an arbitrary/random partition.
  examples.sort((a, b) => Date.parse(a.input.createdAt) - Date.parse(b.input.createdAt));

  const total = examples.length;
  const rounds: RealTrainExample[][] = [[], [], []];
  for (let i = 0; i < total; i++) {
    const roundIndex = Math.floor((i * 3) / total);
    rounds[roundIndex]!.push(examples[i]!);
  }

  return { available: true, totalRecords: total, rounds, missingNumbers };
}
