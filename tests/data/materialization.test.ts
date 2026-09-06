import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadGroundTruth } from "../../src/data/manifests.js";
import { loadPredictorInputs } from "../../src/data/predictorInput.js";
import {
  loadDevEvalHistoricalCorpus,
  loadFinalEvalHistoricalCorpus,
} from "../../src/data/historicalRecords.js";
import { verifyMaterializedHashes, verifyPrivateArtifactHashes } from "../../src/data/materializedHashes.js";
import { redactText } from "../../src/data/redact.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(HERE, "..", "..", "data");

const FORBIDDEN_KEYS = ["label", "subtype", "stateReason", "closedAt", "labels", "milestone", "assignee", "comments"];

function readJsonlRaw(file: string): Record<string, unknown>[] {
  const abs = path.join(DATA_DIR, file);
  return readFileSync(abs, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("materialized predictor-safe files", () => {
  const materialized = verifyMaterializedHashes();
  const available = materialized.available;

  it.skipIf(!available)("hashes match the frozen materialization record", () => {
    for (const r of materialized.results) {
      expect(r.actual, `${r.file} hash mismatch`).toBe(r.expected);
    }
  });

  it.skipIf(!available)("train/dev/final_holdout.jsonl issue-number sets exactly equal the frozen manifests", () => {
    for (const split of ["TRAIN", "DEV", "FINAL_HOLDOUT"] as const) {
      const { available: loaded, extraNumbers, missingNumbers } = loadPredictorInputs(split);
      expect(loaded).toBe(true);
      expect(extraNumbers).toEqual([]);
      expect(missingNumbers).toEqual([]);
    }
  });

  it.skipIf(!available)("no predictor-safe file ever contains a forbidden ground-truth key", () => {
    for (const file of ["train.jsonl", "dev.jsonl", "final_holdout.jsonl"]) {
      const rows = readJsonlRaw(file);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(Object.keys(row).sort()).toEqual(["authorAssociation", "body", "createdAt", "number", "title"]);
        for (const forbidden of FORBIDDEN_KEYS) {
          expect(row[forbidden], `${file} row #${row.number} leaked "${forbidden}"`).toBeUndefined();
        }
      }
    }
  });

  it.skipIf(!available)("uses LF line endings only (deterministic across platforms)", () => {
    for (const file of ["train.jsonl", "dev.jsonl", "final_holdout.jsonl", "train_feedback.jsonl"]) {
      const buf = readFileSync(path.join(DATA_DIR, file));
      expect(buf.includes(Buffer.from("\r\n")), `${file} contains CRLF`).toBe(false);
    }
  });

  it.skipIf(!available)("never fabricates a missing body: absent GitHub body becomes empty string, not placeholder text", () => {
    for (const file of ["train.jsonl", "dev.jsonl", "final_holdout.jsonl"]) {
      const rows = readJsonlRaw(file);
      for (const row of rows) {
        expect(typeof row.body).toBe("string");
      }
    }
  });
});

describe("TRAIN-only feedback artifact (data/train_feedback.jsonl)", () => {
  const available = existsSync(path.join(DATA_DIR, "train_feedback.jsonl"));

  it.skipIf(!available)("contains only TRAIN issue numbers", () => {
    const trainNumbers = new Set(loadGroundTruth("TRAIN").map((g) => g.number));
    const devNumbers = new Set(loadGroundTruth("DEV").map((g) => g.number));
    const finalNumbers = new Set(loadGroundTruth("FINAL_HOLDOUT").map((g) => g.number));
    const rows = readJsonlRaw("train_feedback.jsonl");
    expect(rows.length).toBe(trainNumbers.size);
    for (const row of rows) {
      const n = row.number as number;
      expect(trainNumbers.has(n)).toBe(true);
      expect(devNumbers.has(n)).toBe(false);
      expect(finalNumbers.has(n)).toBe(false);
    }
  });

  it.skipIf(!available)("carries the frozen label/subtype plus post-resolution evidence and provenance", () => {
    const rows = readJsonlRaw("train_feedback.jsonl");
    const truthByNumber = new Map(loadGroundTruth("TRAIN").map((g) => [g.number, g]));
    for (const row of rows) {
      const truth = truthByNumber.get(row.number as number)!;
      expect(row.label).toBe(truth.label);
      expect(row.subtype).toBe(truth.subtype);
      expect(typeof row.sourceUrl).toBe("string");
      expect(row.sourceUrl).toContain(`/issues/${row.number}`);
      expect("closedAt" in row).toBe(true);
    }
  });
});

describe("historical corpus loaders (temporal search contract)", () => {
  it("DEV-eval historical corpus is TRAIN-only — never contains a DEV or FINAL_HOLDOUT number", () => {
    const { available, records } = loadDevEvalHistoricalCorpus();
    if (!available) return; // not yet materialized in this checkout
    const devNumbers = new Set(loadGroundTruth("DEV").map((g) => g.number));
    const finalNumbers = new Set(loadGroundTruth("FINAL_HOLDOUT").map((g) => g.number));
    expect(records.length).toBeGreaterThan(0);
    for (const r of records) {
      expect(devNumbers.has(r.number)).toBe(false);
      expect(finalNumbers.has(r.number)).toBe(false);
    }
  });

  it("FINAL-eval historical corpus (if present locally) is TRAIN+DEV only — never contains a FINAL_HOLDOUT number", () => {
    const { available, records } = loadFinalEvalHistoricalCorpus();
    if (!available) return; // evaluator-private, gitignored — expected absent on a fresh checkout
    const finalNumbers = new Set(loadGroundTruth("FINAL_HOLDOUT").map((g) => g.number));
    const trainNumbers = new Set(loadGroundTruth("TRAIN").map((g) => g.number));
    const devNumbers = new Set(loadGroundTruth("DEV").map((g) => g.number));
    expect(records.length).toBe(trainNumbers.size + devNumbers.size);
    for (const r of records) {
      expect(finalNumbers.has(r.number)).toBe(false);
      expect(trainNumbers.has(r.number) || devNumbers.has(r.number)).toBe(true);
    }
  });
});

describe("evaluator-private artifacts (data/private/, gitignored)", () => {
  const priv = verifyPrivateArtifactHashes();

  it.skipIf(!priv.available)("hashes match the recorded private-artifacts manifest", () => {
    for (const r of priv.results) {
      expect(r.actual, `${r.file} hash mismatch`).toBe(r.expected);
    }
  });

  it("data/private/ is excluded via .gitignore", () => {
    const gitignore = readFileSync(path.resolve(DATA_DIR, "..", ".gitignore"), "utf8");
    expect(gitignore).toMatch(/(^|\n)data\/private\//);
  });
});

describe("redactText", () => {
  it("scrubs emails, tokens, and local file paths while preserving other content", () => {
    const dirty =
      "Contact me at reporter@example.com. Token: ghp_1234567890abcdefghijklmnopqrstuvwxyz. " +
      "Path: C:\\Users\\jsmith\\project\\config.json. The actual bug is that X crashes on Y.";
    const clean = redactText(dirty);
    expect(clean).not.toContain("reporter@example.com");
    expect(clean).not.toContain("ghp_1234567890abcdefghijklmnopqrstuvwxyz");
    expect(clean).not.toContain("jsmith");
    expect(clean).toContain("The actual bug is that X crashes on Y.");
  });

  it("is a no-op on ordinary text", () => {
    const text = "The button does not respond when clicked twice in a row.";
    expect(redactText(text)).toBe(text);
  });
});
