import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Structural guard for "do not read evaluator-private DEV/FINAL ground
 * truth" / "use fixtures until TRAIN materialization lands": the
 * rule-learning layer must never import the manifest ground-truth loader or
 * the evaluator-only DEV/FINAL_HOLDOUT access path. If it needs real data
 * one day, that must go through an explicit, reviewed integration point —
 * not a silent import deep inside the learning/rulebook modules.
 */
describe("src/learning and src/rulebook never read ground truth directly", () => {
  const forbiddenPatterns = [/loadGroundTruth/, /loadEvaluatorGroundTruth/, /requestEvaluatorAccess/, /from ["'].*data\/manifests\.js["']/, /from ["'].*eval\/groundTruthAccess\.js["']/];

  it("has no reference to the manifest/ground-truth loaders anywhere in src/learning or src/rulebook", () => {
    const files = [...listTsFiles(path.join(REPO_ROOT, "src", "learning")), ...listTsFiles(path.join(REPO_ROOT, "src", "rulebook"))];
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const pattern of forbiddenPatterns) {
        if (pattern.test(content)) {
          offenders.push(`${path.relative(REPO_ROOT, file)} matches ${pattern}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
