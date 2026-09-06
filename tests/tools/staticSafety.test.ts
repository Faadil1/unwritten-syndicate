import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const OWNED_SRC_DIRS = [path.join(REPO_ROOT, "src", "tools"), path.join(REPO_ROOT, "src", "instrumentation")];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const ownedFiles = OWNED_SRC_DIRS.flatMap((dir) => listTsFiles(dir));

describe("static safety: no live GitHub path in src/tools or src/instrumentation", () => {
  // Structural proxy for "no live GitHub during DEV or FINAL inference": this
  // layer must contain no network client, no fetch call, and no reference to
  // GitHub's API host or the `gh` CLI anywhere in its own source.
  const forbiddenPatterns = [
    /\bfetch\s*\(/,
    /node:https?\b/,
    /require\(\s*["']https?["']\s*\)/,
    /githubusercontent\.com/,
    /api\.github\.com/,
    /\bgh\s+api\b/,
    /octokit/i,
  ];

  it("has at least one owned source file to scan", () => {
    expect(ownedFiles.length).toBeGreaterThan(0);
  });

  for (const file of ownedFiles) {
    const rel = path.relative(REPO_ROOT, file);
    it(`${rel} contains no live-GitHub / network-fetch pattern`, () => {
      const contents = readFileSync(file, "utf8");
      for (const pattern of forbiddenPatterns) {
        expect(pattern.test(contents)).toBe(false);
      }
    });
  }
});

describe("static safety: no DEV/FINAL ground-truth import in src/tools", () => {
  // The historical-search tool must only ever read the frozen TRAIN split
  // (via loadGroundTruth("TRAIN")) or local fixtures — never DEV/FINAL_HOLDOUT
  // ground truth, and never the evaluator-only access path at all.
  const toolFiles = listTsFiles(path.join(REPO_ROOT, "src", "tools"));

  it("has at least one tools source file to scan", () => {
    expect(toolFiles.length).toBeGreaterThan(0);
  });

  for (const file of toolFiles) {
    const rel = path.relative(REPO_ROOT, file);
    it(`${rel} never imports the evaluator-only ground-truth access module`, () => {
      const contents = readFileSync(file, "utf8");
      // Match an actual import/require of the module, not an incidental doc
      // comment that merely names it (e.g. explaining a rule by contrast).
      expect(/from\s+["'][^"']*groundTruthAccess(?:\.js)?["']/.test(contents)).toBe(false);
      expect(/require\(\s*["'][^"']*groundTruthAccess(?:\.js)?["']\s*\)/.test(contents)).toBe(false);
    });

    it(`${rel} never calls loadGroundTruth with "DEV" or "FINAL_HOLDOUT"`, () => {
      const contents = readFileSync(file, "utf8");
      expect(/loadGroundTruth\(\s*["']DEV["']/.test(contents)).toBe(false);
      expect(/loadGroundTruth\(\s*["']FINAL_HOLDOUT["']/.test(contents)).toBe(false);
    });
  }
});
