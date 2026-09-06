import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGroundTruth, loadExcludedDuplicateFamilies } from "../src/data/manifests.js";
import { redactText } from "../src/data/redact.js";
import type { AuthorAssociation, GroundTruth, ResolutionDisposition, ResolutionSubtype } from "../src/contracts/types.js";

/**
 * GATE 02 / SESSION A2 — dataset materialization.
 *
 * Fetches title/body/authorAssociation for every issue number already
 * present in the frozen GATE 01C manifests, via GitHub's public REST API,
 * READ-ONLY, unauthenticated (no `gh` CLI / token available in this
 * worktree — see AO_BUILD_LEDGER.md SESSION A2 for why; unauthenticated
 * REST is still read-only, no write scope, and the ~12 paginated requests
 * needed for the full 1056-issue corpus fit comfortably inside the 60
 * req/hour unauthenticated rate limit).
 *
 * This script NEVER re-derives the split or the label — it loads
 * `loadGroundTruth()` (hash-verified against the GATE 01C freeze record)
 * and only ever *joins* fetched text onto that frozen truth, failing
 * closed (no files written) if anything doesn't line up.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(HERE, "..", "data");
export const PRIVATE_DIR = path.join(DATA_DIR, "private");
export const REPO_OWNER = "modelcontextprotocol";
export const REPO_NAME = "inspector";
export const SOURCE_URL_BASE = `https://github.com/${REPO_OWNER}/${REPO_NAME}/issues`;

export interface RawGitHubIssue {
  number: number;
  title: string | null;
  body: string | null;
  created_at: string;
  closed_at: string | null;
  author_association: string;
  state_reason: string | null;
  pull_request?: unknown;
}

const EXTERNAL_ASSOCIATIONS: readonly AuthorAssociation[] = ["NONE", "FIRST_TIME_CONTRIBUTOR", "CONTRIBUTOR"];

export function subtypeToLabel(subtype: ResolutionSubtype): ResolutionDisposition {
  return subtype === "COMPLETED" ? "RESOLVED_COMPLETED" : "RESOLVED_NO_NEW_WORK";
}

export function stateReasonToSubtype(stateReason: string | null): ResolutionSubtype | null {
  // GitHub's REST API returns state_reason in lowercase (e.g. "not_planned");
  // the GraphQL API used to build the frozen manifests returns it upper-cased
  // (e.g. "NOT_PLANNED"). Same field, different casing convention per API.
  const normalized = stateReason?.toUpperCase() ?? null;
  if (normalized === "COMPLETED") return "COMPLETED";
  if (normalized === "NOT_PLANNED") return "NOT_PLANNED";
  if (normalized === "DUPLICATE") return "DUPLICATE";
  return null;
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const m = /<([^>]+)>;\s*rel="next"/.exec(part.trim());
    if (m) return m[1]!;
  }
  return null;
}

export async function fetchAllIssues(): Promise<Map<number, RawGitHubIssue>> {
  const byNumber = new Map<number, RawGitHubIssue>();
  let url: string | null =
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues` +
    `?state=all&per_page=100&sort=created&direction=asc`;
  let page = 0;
  while (url) {
    page += 1;
    const resp: Response = await fetch(url, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "unwritten-syndicate-data-materialize" },
    });
    if (!resp.ok) {
      throw new Error(`GitHub REST fetch failed (page ${page}): ${resp.status} ${resp.statusText}`);
    }
    const remaining = resp.headers.get("x-ratelimit-remaining");
    const items = (await resp.json()) as RawGitHubIssue[];
    for (const item of items) {
      if (item.pull_request) continue; // PRs share the issue numbering; exclude them
      if (byNumber.has(item.number)) {
        throw new Error(`Duplicate issue number encountered from GitHub API: #${item.number}`);
      }
      byNumber.set(item.number, item);
    }
    console.log(`  fetched page ${page} (${items.length} items, rate-limit-remaining=${remaining ?? "?"})`);
    url = parseNextLink(resp.headers.get("link"));
  }
  return byNumber;
}

export interface JoinedRecord {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly closedAt: string | null;
  readonly authorAssociation: AuthorAssociation;
  readonly label: ResolutionDisposition;
  readonly subtype: ResolutionSubtype;
  readonly sourceUrl: string;
}

export function joinSplit(
  splitName: string,
  groundTruth: readonly GroundTruth[],
  fetched: Map<number, RawGitHubIssue>,
  errors: string[],
): JoinedRecord[] {
  const seen = new Set<number>();
  const out: JoinedRecord[] = [];
  for (const gt of groundTruth) {
    if (seen.has(gt.number)) {
      errors.push(`${splitName}: duplicate issue number in ground truth: #${gt.number}`);
      continue;
    }
    seen.add(gt.number);

    const raw = fetched.get(gt.number);
    if (!raw) {
      errors.push(`${splitName}: issue #${gt.number} from frozen manifest was not found via GitHub REST fetch`);
      continue;
    }
    if (raw.pull_request) {
      errors.push(`${splitName}: issue #${gt.number} unexpectedly resolved to a pull request`);
      continue;
    }
    if (raw.created_at !== gt.createdAt) {
      errors.push(
        `${splitName}: issue #${gt.number} createdAt mismatch — manifest=${gt.createdAt} fetched=${raw.created_at}`,
      );
      continue;
    }
    if (!EXTERNAL_ASSOCIATIONS.includes(raw.author_association as AuthorAssociation)) {
      errors.push(
        `${splitName}: issue #${gt.number} authorAssociation "${raw.author_association}" is not in the eligible external set`,
      );
      continue;
    }
    const fetchedSubtype = stateReasonToSubtype(raw.state_reason);
    if (fetchedSubtype !== gt.subtype) {
      errors.push(
        `${splitName}: issue #${gt.number} subtype mismatch — manifest=${gt.subtype} fetched_state_reason=${raw.state_reason}`,
      );
      continue;
    }
    if (subtypeToLabel(gt.subtype) !== gt.label) {
      errors.push(`${splitName}: issue #${gt.number} manifest label/subtype internally inconsistent`);
      continue;
    }
    if (typeof raw.title !== "string") {
      errors.push(`${splitName}: issue #${gt.number} has no title`);
      continue;
    }

    out.push({
      number: gt.number,
      title: redactText(raw.title),
      // GitHub represents "no description provided" as body: null. We keep
      // that as an empty string rather than fabricating placeholder text.
      body: redactText(raw.body ?? ""),
      createdAt: gt.createdAt,
      closedAt: raw.closed_at,
      authorAssociation: raw.author_association as AuthorAssociation,
      label: gt.label,
      subtype: gt.subtype,
      sourceUrl: `${SOURCE_URL_BASE}/${gt.number}`,
    });
  }
  return out;
}

export function writeJsonl(absPath: string, rows: readonly unknown[]): void {
  const body = rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length > 0 ? "\n" : "");
  writeFileSync(absPath, body, { encoding: "utf8" });
}

export function sha256Of(absPath: string): string {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

async function main(): Promise<void> {
  console.log("=== data:materialize ===");

  const excluded = new Set(loadExcludedDuplicateFamilies().excludedIssueNumbers);
  const train = loadGroundTruth("TRAIN");
  const dev = loadGroundTruth("DEV");
  const finalHoldout = loadGroundTruth("FINAL_HOLDOUT");

  for (const [name, gts] of [
    ["TRAIN", train],
    ["DEV", dev],
    ["FINAL_HOLDOUT", finalHoldout],
  ] as const) {
    const violating = gts.filter((g) => excluded.has(g.number));
    if (violating.length > 0) {
      throw new Error(`${name} manifest contains excluded duplicate-family issue number(s), refusing to proceed`);
    }
  }

  console.log(`Loaded frozen ground truth: TRAIN=${train.length} DEV=${dev.length} FINAL_HOLDOUT=${finalHoldout.length}`);
  console.log("Fetching full issue corpus from GitHub REST API (read-only, unauthenticated)...");
  const fetched = await fetchAllIssues();
  console.log(`Fetched ${fetched.size} non-PR issues total.`);

  const errors: string[] = [];
  const trainJoined = joinSplit("TRAIN", train, fetched, errors);
  const devJoined = joinSplit("DEV", dev, fetched, errors);
  const finalJoined = joinSplit("FINAL_HOLDOUT", finalHoldout, fetched, errors);

  if (errors.length > 0) {
    console.error(`data:materialize FAILED — ${errors.length} integrity violation(s). No files written.`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }

  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(PRIVATE_DIR, { recursive: true });

  // --- Shared, predictor-safe files (label-free; the ONLY allowed shape) ---
  const toPredictorSafe = (r: JoinedRecord) => ({
    number: r.number,
    title: r.title,
    body: r.body,
    createdAt: r.createdAt,
    authorAssociation: r.authorAssociation,
  });
  const byNumberAsc = <T extends { number: number }>(a: T, b: T) => a.number - b.number;

  const trainSafe = [...trainJoined].sort(byNumberAsc).map(toPredictorSafe);
  const devSafe = [...devJoined].sort(byNumberAsc).map(toPredictorSafe);
  const finalSafe = [...finalJoined].sort(byNumberAsc).map(toPredictorSafe);

  const trainPath = path.join(DATA_DIR, "train.jsonl");
  const devPath = path.join(DATA_DIR, "dev.jsonl");
  const finalPath = path.join(DATA_DIR, "final_holdout.jsonl");
  writeJsonl(trainPath, trainSafe);
  writeJsonl(devPath, devSafe);
  writeJsonl(finalPath, finalSafe);

  // --- TRAIN-only feedback artifact (label + post-resolution evidence + provenance) ---
  const trainFeedback = [...trainJoined].sort(byNumberAsc).map((r) => ({
    number: r.number,
    title: r.title,
    body: r.body,
    createdAt: r.createdAt,
    authorAssociation: r.authorAssociation,
    label: r.label,
    subtype: r.subtype,
    closedAt: r.closedAt,
    sourceUrl: r.sourceUrl,
  }));
  const trainFeedbackPath = path.join(DATA_DIR, "train_feedback.jsonl");
  writeJsonl(trainFeedbackPath, trainFeedback);

  // --- Evaluator-private, local-only artifacts (never committed; see .gitignore) ---
  const devGroundTruthPath = path.join(PRIVATE_DIR, "dev_ground_truth.jsonl");
  const finalGroundTruthPath = path.join(PRIVATE_DIR, "final_holdout_ground_truth.jsonl");
  const historyForFinalPath = path.join(PRIVATE_DIR, "history_train_dev_for_final.jsonl");

  const toGroundTruthJoined = (r: JoinedRecord) => ({
    number: r.number,
    title: r.title,
    body: r.body,
    createdAt: r.createdAt,
    authorAssociation: r.authorAssociation,
    label: r.label,
    subtype: r.subtype,
    closedAt: r.closedAt,
    sourceUrl: r.sourceUrl,
  });
  writeJsonl(devGroundTruthPath, [...devJoined].sort(byNumberAsc).map(toGroundTruthJoined));
  writeJsonl(finalGroundTruthPath, [...finalJoined].sort(byNumberAsc).map(toGroundTruthJoined));

  // FINAL's historical search corpus: TRAIN + DEV (both strictly precede
  // FINAL_HOLDOUT chronologically per the frozen split boundaries,
  // EVAL_CONTRACT.md §13). This is the artifact that first joins DEV text
  // to DEV's outcome, so it must stay evaluator-private (see .gitignore).
  const historyForFinal = [...trainJoined, ...devJoined]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .map((r) => ({
      number: r.number,
      title: r.title,
      body: r.body,
      createdAt: r.createdAt,
      authorAssociation: r.authorAssociation,
      label: r.label,
      subtype: r.subtype,
    }));
  writeJsonl(historyForFinalPath, historyForFinal);

  // --- Freeze hashes ---
  const sharedHashes: Record<string, { records: number; sha256: string }> = {
    "train.jsonl": { records: trainSafe.length, sha256: sha256Of(trainPath) },
    "dev.jsonl": { records: devSafe.length, sha256: sha256Of(devPath) },
    "final_holdout.jsonl": { records: finalSafe.length, sha256: sha256Of(finalPath) },
    "train_feedback.jsonl": { records: trainFeedback.length, sha256: sha256Of(trainFeedbackPath) },
  };
  writeFileSync(
    path.join(DATA_DIR, "materialized_hashes.json"),
    JSON.stringify(sharedHashes, null, 2) + "\n",
    "utf8",
  );

  const privateHashes: Record<string, { path: string; records: number; sha256: string }> = {
    "dev_ground_truth.jsonl": {
      path: "data/private/dev_ground_truth.jsonl",
      records: devJoined.length,
      sha256: sha256Of(devGroundTruthPath),
    },
    "final_holdout_ground_truth.jsonl": {
      path: "data/private/final_holdout_ground_truth.jsonl",
      records: finalJoined.length,
      sha256: sha256Of(finalGroundTruthPath),
    },
    "history_train_dev_for_final.jsonl": {
      path: "data/private/history_train_dev_for_final.jsonl",
      records: historyForFinal.length,
      sha256: sha256Of(historyForFinalPath),
    },
  };
  writeFileSync(
    path.join(DATA_DIR, "private_artifacts_manifest.json"),
    JSON.stringify(privateHashes, null, 2) + "\n",
    "utf8",
  );

  console.log("data:materialize PASSED.");
  console.log(`  data/train.jsonl: ${trainSafe.length} records`);
  console.log(`  data/dev.jsonl: ${devSafe.length} records`);
  console.log(`  data/final_holdout.jsonl: ${finalSafe.length} records`);
  console.log(`  data/train_feedback.jsonl: ${trainFeedback.length} records`);
  console.log(`  data/private/dev_ground_truth.jsonl: ${devJoined.length} records (LOCAL ONLY, gitignored)`);
  console.log(`  data/private/final_holdout_ground_truth.jsonl: ${finalJoined.length} records (LOCAL ONLY, gitignored)`);
  console.log(`  data/private/history_train_dev_for_final.jsonl: ${historyForFinal.length} records (LOCAL ONLY, gitignored)`);
}

// Guarded so importing helpers from this module (e.g. the DEV-only
// materializer) never triggers the full TRAIN+DEV+FINAL_HOLDOUT run as a
// side effect of the import.
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? "")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
