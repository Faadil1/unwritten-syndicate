import type { AuthorAssociation, PredictorInput, ResolutionDisposition } from "../contracts/types.js";
import type { TrainExample } from "./orchestrator.js";

/**
 * Synthetic, clearly-labeled TRAIN-only fixture data.
 *
 * `data/train.jsonl` (GATE 02 dataset materialization) does not exist yet in
 * this repository as of this session — per the session brief, "use fixtures
 * until TRAIN materialization lands." This module is that stand-in: it
 * exercises the full learning pipeline (orchestrator / Reflector / Rulebook)
 * end to end with made-up numbers. It is NOT derived from real GitHub data,
 * must never be treated as a benchmark result, and should be deleted once
 * `loadPredictorInputs("TRAIN")` (src/data/predictorInput.ts) reports
 * `available: true`.
 */

interface Spec {
  readonly authorAssociation: AuthorAssociation;
  readonly bodyChars: number;
  readonly question: boolean;
  readonly actual: ResolutionDisposition;
}

function title(wordCount: number, question: boolean): string {
  const words = Array.from({ length: wordCount }, (_, i) => `word${i}`);
  if (question) words[words.length - 1] = `${words[words.length - 1]}?`;
  return words.join(" ");
}

function body(charCount: number): string {
  return "x".repeat(charCount);
}

/**
 * One round's worth of specs, designed so each abstracted feature carries a
 * clean, non-contradictory signal:
 *  - authorAssociation=CONTRIBUTOR (short body, question-style title) skews RESOLVED_NO_NEW_WORK (3/4)
 *  - authorAssociation=NONE (long body, no question) is uniformly RESOLVED_COMPLETED (4/4)
 *  - authorAssociation=FIRST_TIME_CONTRIBUTOR (medium body, no question) is evenly split (2/2) — deliberately no dominant signal
 */
function buildRoundSpecs(): readonly Spec[] {
  const contributor: ResolutionDisposition[] = [
    "RESOLVED_NO_NEW_WORK",
    "RESOLVED_NO_NEW_WORK",
    "RESOLVED_NO_NEW_WORK",
    "RESOLVED_COMPLETED",
  ];
  const none: ResolutionDisposition[] = [
    "RESOLVED_COMPLETED",
    "RESOLVED_COMPLETED",
    "RESOLVED_COMPLETED",
    "RESOLVED_COMPLETED",
  ];
  const firstTime: ResolutionDisposition[] = [
    "RESOLVED_COMPLETED",
    "RESOLVED_COMPLETED",
    "RESOLVED_NO_NEW_WORK",
    "RESOLVED_NO_NEW_WORK",
  ];
  return [
    ...contributor.map((actual): Spec => ({ authorAssociation: "CONTRIBUTOR", bodyChars: 50, question: true, actual })),
    ...none.map((actual): Spec => ({ authorAssociation: "NONE", bodyChars: 900, question: false, actual })),
    ...firstTime.map(
      (actual): Spec => ({ authorAssociation: "FIRST_TIME_CONTRIBUTOR", bodyChars: 400, question: false, actual }),
    ),
  ];
}

function specToExample(spec: Spec, number: number, round: number): TrainExample {
  const input: PredictorInput = {
    title: title(5, spec.question),
    body: body(spec.bodyChars),
    createdAt: `2025-0${round}-01T00:00:00Z`,
    authorAssociation: spec.authorAssociation,
  };
  return { number, input, actual: spec.actual };
}

/** Builds 3 TRAIN-only batches (12 examples each) with the same reinforcing pattern, so evidence accumulates round over round. */
export function buildFixtureTrainRounds(): readonly (readonly TrainExample[])[] {
  const rounds: TrainExample[][] = [];
  let counter = 1;
  for (let round = 1; round <= 3; round++) {
    const specs = buildRoundSpecs();
    rounds.push(specs.map((spec) => specToExample(spec, counter++, round)));
  }
  return rounds;
}
