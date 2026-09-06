import type { PredictorInput } from "../contracts/types.js";
import type { FeatureVector } from "../rulebook/types.js";

function lengthBucket(charCount: number): "short" | "medium" | "long" {
  if (charCount < 200) return "short";
  if (charCount < 800) return "medium";
  return "long";
}

function wordCount(text: string): number {
  return text.trim().length === 0 ? 0 : text.trim().split(/\s+/).length;
}

function titleBucket(wordCountValue: number): "short" | "medium" | "long" {
  if (wordCountValue < 4) return "short";
  if (wordCountValue < 9) return "medium";
  return "long";
}

/**
 * Derives the closed, abstracted feature vector a rule's conditions may
 * reference (see rulebook/types.ts CONDITION_FEATURES). This is the ONLY
 * place PredictorInput's raw title/body text is read on the learning side —
 * everything downstream (Reflector, Rulebook) operates on these abstracted
 * buckets/flags, never on the raw strings or the issue number, which is how
 * "abstract across experiences, don't cache issue->outcome tuples" is
 * enforced structurally rather than by convention.
 */
export function extractFeatures(input: PredictorInput): FeatureVector {
  return {
    authorAssociation: input.authorAssociation,
    bodyLengthBucket: lengthBucket(input.body.length),
    titleLengthBucket: titleBucket(wordCount(input.title)),
    hasQuestionMark: input.body.includes("?") || input.title.includes("?"),
    hasCodeBlock: input.body.includes("```"),
  };
}
