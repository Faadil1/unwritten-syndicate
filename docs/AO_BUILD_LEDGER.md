# AO_BUILD_LEDGER — GATE 01 / GATE 01B / GATE 01C

See "GATE 01B" and "GATE 01C" sections near the end of this file for the
second and third gates' ledger entries. Everything above the "GATE 01B"
heading is unmodified from GATE 01.

Record of what actually happened in this session, limited to what is
genuinely visible to this harness. No AO session IDs, worktree IDs, or
other AO-internal identifiers are exposed inside this Claude Code harness;
where such metadata would normally go, this is recorded explicitly rather
than invented.

## Session identity

- AO session ID: not exposed to harness
- AO worktree ID/path metadata: not exposed to harness (the `ao` CLI itself
  is not present in this harness's PATH — confirmed via failed lookup in
  both bash and PowerShell at the start of this gate)
- Agent role: Orchestrator (per this project's standing operating rules),
  operating in a user-confirmed direct-edit exception for this gate only
  (see below)

## Environment observed directly

- Local project path acted on: `C:\Users\fboussari\Documents\unwritten-syndicate`
- Git remote: `https://github.com/Faadil1/unwritten-syndicate.git`
- Git branch at time of work: `main`
- Pre-existing commit before this gate: `559579ed9c9cf43ffed0355849b470c90a27d34f`
  ("initial commit", author `Agent Orchestrator <ao@example.com>`,
  authored 2026-09-06T03:43:49-04:00), tree empty (`git ls-files` returned
  no tracked files) — confirms the repository was fresh at gate start.
- `gh` CLI version: `2.96.0`
- `gh auth status`: logged in to `github.com` as `Faadil1`, active account,
  HTTPS protocol, scopes `gist, read:org, repo, workflow`
- `node` version used for local analysis scripts: `v24.16.0`
- OS: Windows 11 (per system environment), commands run through Git Bash
  (`/usr/bin/bash`) and PowerShell tool interfaces

## Deviation from default orchestrator role (explicit, user-confirmed)

Standing project rules default to: orchestrator never edits files or
commits directly; implementation work is delegated to a spawned worker
session. For this gate, the human operator explicitly instructed:

- Do not spawn a worker for this gate.
- Do not depend on or require the `ao` CLI.
- Work directly in the repository using ordinary shell/git/gh commands.

Per this project's standing rule ("if the human explicitly insists that the
orchestrator itself make code changes, ask for explicit confirmation before
making any code changes"), explicit confirmation was requested via
AskUserQuestion and the human selected "Yes, proceed directly" before any
file was written or committed. This ledger entry documents that exception;
it applies to this gate only and does not change the default rule for
future gates.

## Actions performed this gate (chronological)

1. Verified working directory and git state (`git status`, `git log`,
   `git remote -v`, `git show --stat HEAD`, `git ls-files`) — confirmed
   fresh repo, one empty commit, `origin` pointed at
   `Faadil1/unwritten-syndicate`.
2. Verified `gh auth status` and `gh repo view modelcontextprotocol/inspector`
   (read-only) to confirm public data access.
3. Pulled all 1056 issues from `modelcontextprotocol/inspector` via
   paginated `gh api graphql` (read-only; no writes to that repository).
4. Analyzed label/state distribution and chronological split feasibility
   using local Node.js scripts (no data committed; scripts were scratch
   files under the OS temp directory, not part of this repository).
5. Selected a 2-class taxonomy (`bug`, `enhancement`) based on the observed
   distribution and drift analysis.
6. Authored `docs/PROJECT_SPEC.md`, `docs/EVAL_CONTRACT.md`,
   `docs/COMPLIANCE.md`, `docs/AO_BUILD_LEDGER.md` (this file),
   `docs/IMPLEMENTATION_PLAN.md`.
7. Committed the five documentation files to `main` in
   `C:\Users\fboussari\Documents\unwritten-syndicate`. No push performed.

## Commit produced by this gate

- SHA: recorded in the "G. commit SHA" line of the final gate report
  returned to the human (git does not allow predicting the SHA before
  `git commit` runs, so it is not duplicated here — see repository
  `git log` for the authoritative record).

## Explicitly not done in GATE 01

- No agent code (PolicyAgent, Reflector, rulebook/memory engine, learning
  rounds, demo UI) was implemented.
- No push to the remote GitHub repository was performed.
- No issue body/title text was retrieved or stored.

---

## GATE 01B — BENCHMARK HARDNESS + POLICY TARGET REDESIGN

### Session identity (unchanged from GATE 01)

- AO session ID: not exposed to harness
- AO worktree ID/path metadata: not exposed to harness
- Agent role: Orchestrator, operating under the same user-confirmed
  direct-edit exception established for GATE 01. The human's GATE 01B
  instructions continued the same working mode (no worker spawned, direct
  shell/git/gh use); this ledger treats that as continuation of the same
  explicit exception rather than re-litigating it, since the modality
  (docs-only, no code, no push) is identical to what was already confirmed.

### Environment observed directly

- Local project path acted on: `C:\Users\fboussari\Documents\unwritten-syndicate`
  (all edits performed via absolute paths from the orchestrator's own
  working directory, which is a separate AO worktree —
  `C:\Users\fboussari\.ao\data\worktrees\unwritten-syndicate\orchestrator\unwritten-sy-orchestrator`
  — that this Bash tool's shell resets to between invocations; every
  command explicitly `cd`'d into the target project path first).
- Pre-existing commit before this gate:
  `ee2e6581496d86c9d0dd19819daa963c12555ea2` ("GATE 01: spec + eval
  contract for issue-triage taxonomy").
- `gh` CLI, `node` (v24.16.0) used identically to GATE 01.
- Additional GraphQL fields queried in this gate: `stateReason`,
  `authorAssociation`, `author { login }`, plus targeted `title`/`body`/
  `comments(first: 10)` fetches for two fixed samples (25-issue DEV
  lexical audit sample; 20-issue `DUPLICATE`-stateReason cross-reference
  sweep) — see EVAL_CONTRACT.md §6–7 for exact issue numbers and queries.
- All intermediate analysis (issue pulls, Node.js scripts, regex
  cross-reference extraction) was done in scratch files under the OS temp
  directory (`/tmp` under Git Bash, i.e. the Windows temp directory), never
  committed to this repository.

### Actions performed this gate (chronological)

1. Re-pulled all 1056 issues via paginated `gh api graphql`, this time
   including `stateReason`, `authorAssociation`, `author.login`.
2. Computed raw `stateReason` distribution (`COMPLETED` 795, `NOT_PLANNED`
   205, `DUPLICATE` 20, open/unresolved 36) and cross-tabulated against
   `authorAssociation`, discovering the internal-authorship leak
   (`MEMBER`-authored issues resolve `COMPLETED` 91% of the time vs. 62%
   for `NONE`-authored).
3. Investigated the GATE 01 label-completeness drift finding (54%/40%/97%)
   and traced it to a concrete, dateable cause: a bulk `closed-v1-deprecated`
   migration purge that closed 56 issues as `NOT_PLANNED` on a single day,
   2026-08-01.
4. Defined and applied eligibility filters (external authorship, exclude
   v1-purge-labeled issues, exclude censored/open issues) and recomputed
   chronological TRAIN/DEV/FINAL_HOLDOUT splits on the filtered population
   (459 issues).
5. Ran a hardness test on two additional candidates (version routing,
   subsystem/ownership routing) and rejected both on structural lexical-
   leakage grounds (explicit version/subsystem strings in reporter
   templates) — see EVAL_CONTRACT.md §3.
6. Pulled title/body/comments for a fixed, predeclared 25-issue DEV sample
   and manually audited it for lexical leakage — this sample is what
   originally surfaced the authorship confound in step 2 (documented
   honestly in EVAL_CONTRACT.md §6 rather than replaced with a
   post-hoc-cleaner sample).
7. Pulled title/body/comments for all 20 `DUPLICATE`-stateReason issues in
   the full 1056-issue population, regex-extracted `#<number>`
   cross-references, and checked each referenced issue's split membership.
   Found one confirmed cross-split connected group (6 issues, the
   "platform storage / keyring `PermissionDenied`" cluster spanning
   DEV/FINAL_HOLDOUT) and excluded it from evaluation per the
   duplicate-protection rule.
8. Rewrote `docs/EVAL_CONTRACT.md` in full (kept the GATE 01 analysis as a
   marked-rejected §0 rather than deleting it), updated
   `docs/PROJECT_SPEC.md` (§3 marked rejected, new §3B taxonomy added),
   updated `docs/IMPLEMENTATION_PLAN.md` (GATE 02 plan rewritten against
   the new target), and appended this GATE 01B section to
   `docs/AO_BUILD_LEDGER.md`.
9. Committed the four updated documentation files to `main` as a new
   commit (not an amend). No push performed.

### Commit produced by this gate

- SHA: recorded in the "K. new commit SHA" line of the final gate report
  returned to the human (see repository `git log` for the authoritative
  record; not duplicated here since it cannot be known before `git commit`
  runs).

### Explicitly not done in GATE 01B

- No agent code (PolicyAgent, Reflector, rulebook/memory engine, learning
  rounds, demo UI) was implemented.
- No push to the remote GitHub repository was performed.
- No dataset files (`data/*.jsonl`) were committed — only aggregate
  statistics and the two targeted audit samples (documented by issue
  number, not stored as files) appear in the updated docs.
- No full-corpus duplicate/related-case sweep was run (only the 20
  `DUPLICATE`-stateReason issues were checked) — explicitly deferred to
  GATE 02, see IMPLEMENTATION_PLAN.md.
- The GATE 01 commit (`ee2e658...`) was not amended or rewritten; this
  gate's changes are a new commit.

---

## GATE 01C — FINAL BENCHMARK FREEZE

### Session identity (unchanged from GATE 01/01B)

- AO session ID: not exposed to harness
- AO worktree ID/path metadata: not exposed to harness
- Agent role: Orchestrator, continuing the same user-confirmed direct-edit
  exception (docs-only, no code, no push) established for GATE 01 and
  continued through GATE 01B without re-confirmation, per the same
  reasoning recorded in the GATE 01B ledger entry.

### Environment observed directly

- Local project path acted on: `C:\Users\fboussari\Documents\unwritten-syndicate`.
- Pre-existing commit before this gate: `959df60676d7ff5be5662a34db2fac24aafe80c4`
  ("GATE 01B: redesign eval target after benchmark-hardness review").
- `gh` CLI, `node` (v24.16.0) used identically to prior gates.
- All GraphQL fetches, connected-component computation, boundary search,
  and the manual cold-baseline read were performed in scratch files under
  the OS temp directory, then only the derived manifests (issue number,
  label, subtype, `createdAt`) and diagnostic results were copied into the
  repository at `data/gate01c_manifests/` — no raw title/body/comment text
  is committed anywhere in this repository.

### Actions performed this gate (chronological)

1. Computed the TRAIN+DEV (pre-GATE-01B-T2) time-to-resolution distribution
   for the 389 eligible resolved issues (p50 13.0 days, p75 62.1 days, p90
   152.7 days, p95 183.9 days) and chose a 60-day maturity lag from it,
   before touching FINAL_HOLDOUT or any model.
2. Recomputed the eligible-before-maturity population (374 of 443 total
   eligible-resolved issues; 69 dropped as too-immature) and searched for
   the smallest FINAL_HOLDOUT window satisfying total ≥ 50 and
   `RESOLVED_NO_NEW_WORK` ≥ 15 — found an initial 86-issue window, then had
   to grow it to 92 (pre-exclusion) / 88 (post-exclusion) once the §12.4
   duplicate-family exclusion was applied and reduced the raw minority
   count below the floor.
3. Fetched `title`, `body`, and up to 15 comments for all 443
   eligible-resolved issues in 12 batched GraphQL queries (40 issues per
   batch), then built a cross-reference graph via regex `#\d+` extraction
   and union-find connected-components, finding 28 multi-issue groups (85
   edges total).
4. Checked all 28 groups against the new TRAIN/DEV/HOLDOUT boundaries;
   found 7 groups crossing a real-partition boundary (14 issue instances)
   and excluded them from evaluation.
5. Finalized boundaries: T1 = 2025-07-09T16:01:24Z, T2 =
   2025-09-13T06:19:40Z, maturity cutoff = 2026-07-08T00:08:45Z. Final
   counts: TRAIN 206 (176/30), DEV 66 (56/10), FINAL_HOLDOUT 88 (73/15).
6. Extracted title+body (no labels/stateReason) for all 66 final DEV
   issues into a blind-review file, and manually applied one fixed
   classification protocol (predict `RESOLVED_COMPLETED` unless the report
   reads as spam/vague/off-topic/discussion-only/support-question) across
   all 66, recording predictions before comparing to ground truth.
7. Scored the 66 predictions against ground truth: macro-F1 0.6042,
   accuracy 0.7424, confusion matrix and per-class P/R/F1 computed and
   saved to `data/gate01c_manifests/dev_cold_baseline_results.json`.
8. Built final manifests (`manifest_train.json`, `manifest_dev.json`,
   `manifest_final_holdout.json`, `manifest_excluded_duplicate_families.json`)
   containing only issue number, binary label, evaluator-only subtype, and
   `createdAt` — no body/title/comment text — and computed SHA-256 hashes
   for each, recorded in `manifest_hashes.txt`. Verified hashes match after
   copying files into the repository (byte-identical).
9. Rewrote `docs/EVAL_CONTRACT.md` §12–§15 (GATE 01C sections, appended;
   §0–§11 preserved from GATE 01B), updated `docs/PROJECT_SPEC.md` (§3B
   pointer updated to reference the frozen names/counts),
   `docs/IMPLEMENTATION_PLAN.md` (rewritten GATE 02/03 plans against the
   frozen manifests), and appended this GATE 01C section to
   `docs/AO_BUILD_LEDGER.md`.
10. Committed the four updated documentation files plus the new
    `data/gate01c_manifests/` directory to `main` as a new commit (not an
    amend). No push performed.

### Commit produced by this gate

- SHA: recorded in the "J. new commit SHA" line of the final gate report
  returned to the human (see repository `git log` for the authoritative
  record).

### Explicitly not done in GATE 01C

- No agent code (PolicyAgent, Reflector, rulebook/memory engine, learning
  rounds, demo UI) was implemented.
- No push to the remote GitHub repository was performed.
- No `data/train.jsonl`/`data/dev.jsonl`/`data/final_holdout.jsonl` with
  title/body text was materialized — only the number/label/subtype/date
  manifests and diagnostic results, per COMPLIANCE.md scope. Full-text
  dataset materialization remains GATE 02.
- No standalone model API call was made for the cold baseline (§12.5); the
  orchestrator LLM itself served as the "intended underlying model," which
  is disclosed explicitly in EVAL_CONTRACT.md §12.5 rather than presented
  as an independent third-party baseline.
- FINAL_HOLDOUT was not touched by the cold-baseline run (§12.5 used DEV
  only, per instruction).
- Prior commits (`ee2e658...`, `959df60...`) were not amended or rewritten;
  this gate's changes are a new commit.

## SESSION A — DATA + EVAL (post GATE 01C, pre GATE 02)

Record of the Data + Eval implementation worker session. No AO session
metadata is invented here beyond what is genuinely exposed to this harness.

### Session identity

- AO session ID: `unwritten-syndicate-2` (exposed via `$AO_SESSION_ID` in this harness)
- Git worktree branch: `ao/unwritten-syndicate-2/root`
- Base commit verified before any change: `73e4143` ("GATE 01C: freeze final
  benchmark (resolution-disposition target)") — confirmed present in `git log`
  before starting.

### What this session found and fixed before building anything

- On first hash-verification attempt, all four frozen manifest files under
  `data/gate01c_manifests/` failed SHA-256 verification against
  `manifest_hashes.txt`. Root-caused to `core.autocrlf=true` in this Windows
  git environment silently rewriting the manifests' original LF line endings
  to CRLF on checkout — a local checkout artifact, not a change to the frozen
  data itself (confirmed: `git show HEAD:<path> | sha256sum` on each of the
  four files matched the frozen record exactly).
- Fix applied: added `.gitattributes` at the repo root (`data/gate01c_manifests/* -text`
  plus a general `* text=auto eol=lf`), then re-checked out the four
  manifest files. All four now hash-match the frozen record exactly. No
  manifest content was edited.

### Files created (this session)

- `package.json`, `tsconfig.json` — Node/TypeScript project skeleton
  (`type: module`, strict TS, vitest for tests, tsx for script execution).
- `src/contracts/types.ts` — shared contracts: `PredictorInput`,
  `GroundTruth`, `HistoricalRecord`, `Prediction`, `EvaluationResult`,
  `PolicyRule`, `RulebookSnapshot`, `ToolTrace`, plus supporting types.
- `src/data/manifests.ts` — frozen-hash table, `verifyManifestHashes`,
  `assertManifestsIntact`, `loadGroundTruth`, `loadExcludedDuplicateFamilies`.
- `src/data/guards.ts` — `assertNoSplitOverlap`,
  `assertDuplicateFamiliesExcluded`, `filterToPastRecords`, `assertAllPast`
  (historical search / no-future-record contract).
- `src/data/historicalRecords.ts` — `HistoricalRecordStore`: temporal-only
  retrieval abstraction consumed by the A1 raw-RAG baseline plumbing.
- `src/data/predictorInput.ts` — `toPredictorInput` (hard field allowlist:
  `title`/`body`/`createdAt`/`authorAssociation` only, all other keys
  dropped) and `loadPredictorInputs` (reads `data/{train,dev,final_holdout}.jsonl`
  once GATE 02 materializes them; reports `available: false` rather than
  fabricating data since those files do not exist yet in this gate).
- `src/eval/groundTruthAccess.ts` — evaluator-only ground-truth access;
  FINAL_HOLDOUT requires an explicit `EvaluatorAccessToken` obtained via a
  fixed acknowledgment string, so FINAL_HOLDOUT truth cannot be fetched by
  accident from a predictor or rule-learning code path.
- `src/eval/metrics.ts` — confusion matrix, per-class precision/recall/F1,
  macro-F1, accuracy, completion/error accounting (`evaluate`), plus
  `majorityBaselinePredictions`.
- `src/eval/permutation.ts` — `deterministicShuffle` (seeded, SHA-256 +
  mulberry32) and `scrambleRulebook` for A2.
- `src/eval/harness.ts` — `runPredictor`/`runA0Cold` (isolated, per-item
  try/catch, frozen input objects), `makeA1Predictor` (raw-RAG plumbing over
  `HistoricalRecordStore`), `makeA2Predictor` (scrambled-rulebook plumbing).
- `scripts/env-check.ts`, `scripts/data-verify.ts`, `scripts/eval-cold.ts`,
  `scripts/eval-dev.ts` — the four required npm commands.
- `tests/data/manifests.test.ts`, `tests/data/guards.test.ts`,
  `tests/data/predictorInputBoundary.test.ts`,
  `tests/eval/groundTruthAccess.test.ts`, `tests/eval/metrics.test.ts`,
  `tests/eval/permutation.test.ts`, `tests/eval/harness.test.ts` — 41 tests,
  all passing.
- `.gitattributes` — line-ending fix described above.

### Verification performed

- `npm run env:check` — PASSED (4/4 manifest hashes match frozen record).
- `npm run data:verify` — PASSED (206/66/88 records; no split overlap; no
  duplicate-family contamination).
- `npm run eval:cold` — PASSED: re-scored the frozen
  `dev_cold_baseline_results.json` predictions through this session's own
  `evaluate()` implementation; reproduced macro-F1 0.6042 / accuracy 0.7424
  exactly, matching EVAL_CONTRACT.md §12.5. No new model inference was run;
  this only proves the metrics engine is self-consistent with the frozen
  record. DEV only — FINAL_HOLDOUT was not touched.
- `npm run eval:dev` — reports that `data/dev.jsonl` (title/body
  materialization) does not exist yet (GATE 02's deliverable, per
  `docs/IMPLEMENTATION_PLAN.md`); prints that plumbing is wired and ready
  and exits without fabricating a result.
- `npm test` (vitest) — 41/41 tests passed, including: manifest hash
  equality, TRAIN/DEV/FINAL_HOLDOUT disjointness (plus an injected-overlap
  negative test), duplicate-family exclusion (plus injected-violation
  negative test), the full `PredictorInput` field-allowlist boundary
  (dropping `label`/`subtype`/`stateReason`/`closedAt`/`labels`/`milestone`/
  `assignee`/`comments`), FINAL_HOLDOUT evaluator-only gating, historical
  search temporal contract (no future records, via both a direct filter
  test and `HistoricalRecordStore`), confusion-matrix/macro-F1 arithmetic
  against hand-computed expected values, and deterministic-shuffle/A2
  rulebook-permutation reproducibility.
- `npx tsc -p tsconfig.json --noEmit` — clean, no errors.

### Explicitly not done in this session (by design, per task scope)

- No `src/learning/**`, `src/rulebook/**`, `src/tools/**`,
  `src/instrumentation/**`, or demo UI code was written.
- No dataset materialization (`data/train.jsonl` / `data/dev.jsonl` /
  `data/final_holdout.jsonl`) was performed — that is GATE 02's scope per
  `docs/IMPLEMENTATION_PLAN.md`; this session only built the loader
  plumbing that will consume those files once they exist.
- No model inference was run anywhere in this session (A0/A1/A2 harness
  plumbing was built and unit-tested with fake predictors only).
- FINAL_HOLDOUT ground truth was loaded exactly once, inside a test, purely
  to confirm its record count (88) via the evaluator-access-token path — its
  labels were never scored against any prediction and no performance number
  involving FINAL_HOLDOUT was computed or inspected.
- No push to the remote GitHub repository was performed; work is committed
  on the local AO worker branch only.

### Commit produced by this session

- Branch: `ao/unwritten-syndicate-2/root`
- SHA: recorded in the handoff response returned after this ledger entry
  was committed (see `git log` on this branch for the authoritative record).

## SESSION A2 — DATA MATERIALIZATION (GATE 02)

Record of the dataset-materialization worker session, continuing from
SESSION A above on the same base commit lineage (`6790ecd`, the merged
Data+Eval layer).

### Session identity

- AO session ID: `unwritten-syndicate-2`
- Git worktree branch: `ao/unwritten-syndicate-2/root`
- Base commit verified before any change: `6790ecd` (merge of SESSION A),
  confirmed on top of `origin/main`.

### Access-method deviation (explicit, disclosed)

Prior gates used `gh api graphql` (authenticated `gh` CLI) for all GitHub
reads. In this worktree, neither the `gh` CLI nor a `GITHUB_TOKEN`/`GH_TOKEN`
environment variable was present (`gh` not found on PATH in both Git Bash
and PowerShell; no relevant env vars set). Rather than block on that,
`scripts/materialize-dataset.ts` uses GitHub's public REST API
**unauthenticated** — still strictly read-only, no write scope, no
credentials of any kind. The full `modelcontextprotocol/inspector` issue
corpus (1058 non-PR issues at fetch time) was retrieved in 23 paginated
requests (`per_page=100`), comfortably inside the 60 req/hour unauthenticated
rate limit (17 requests of headroom remained at completion). This is
disclosed as a deviation from the `gh`-based method documented in prior
gates' ledger entries, not a silent substitution.

One data-shape difference between the two APIs was caught by the script's
own integrity checks and fixed before any file was written: GitHub's REST
API returns `state_reason` lowercased (e.g. `"not_planned"`), while the
GraphQL API used to build the frozen manifests returns it upper-cased
(e.g. `"NOT_PLANNED"`). The comparison was made case-insensitive; no
manifest content was touched.

### What this session verified before writing anything

Per instruction, none of the following were changed, and this was checked,
not assumed: the frozen benchmark target, split boundaries/IDs, the 60-day
maturity lag, the duplicate-family exclusions, the four `manifest_*.json`
SHA-256 hashes, or the `PredictorInput` field contract. `npm run env:check`,
`npm run data:verify` (pre-existing checks), `npm test` (41/41), and
`npx tsc --noEmit` all passed against the inherited `6790ecd` state before
`scripts/materialize-dataset.ts` was written.

`scripts/materialize-dataset.ts` itself never re-derives a split or a label
— it calls the existing hash-verified `loadGroundTruth()` for TRAIN/DEV/
FINAL_HOLDOUT and only ever *joins* freshly fetched title/body/
author_association onto that already-frozen truth, per-record, failing
closed (no output files written at all) if any of the following don't line
up for every single manifest issue number: the issue must be found (not
missing), must not be a pull request, its fetched `created_at` must exactly
match the frozen manifest's `createdAt`, its `author_association` must be
in the eligible external set (`NONE`/`FIRST_TIME_CONTRIBUTOR`/
`CONTRIBUTOR`), and its fetched `state_reason` must match the frozen
`subtype`. On the actual run, zero violations were found across all 360
manifest issue numbers (206 TRAIN + 66 DEV + 88 FINAL_HOLDOUT).

### Files created (this session)

- `src/data/redact.ts` — pattern-based scrub (private-key blocks, GitHub/
  AWS/JWT/Bearer tokens, email addresses, Windows/Unix user-profile paths)
  applied to all fetched title/body text before it is written to any file,
  addressing the open item in `COMPLIANCE.md` §5 item 1. Verified: 0
  suspicious leftovers found in the materialized files after the pass.
- `scripts/materialize-dataset.ts` — the fetch/join/redact/hash/write
  pipeline described above; runnable via `npm run data:materialize`. This
  is the only script in the project that performs a live GitHub call —
  `eval:cold`/`eval:dev` and all `src/` code paths read exclusively from the
  materialized local files, so no live GitHub access occurs during any
  subsequent DEV or FINAL inference.
- `src/data/materializedHashes.ts` — `verifyMaterializedHashes()` /
  `verifyPrivateArtifactHashes()`, mirroring `manifests.ts`'s hash-check
  pattern for the newly materialized artifacts; both report
  `available: false` rather than failing when files aren't present (e.g. a
  fresh checkout without the gitignored private artifacts).
- `tests/data/materialization.test.ts` — 13 new tests: materialized-hash
  integrity, exact issue-number-set equality against the frozen manifests,
  the predictor-safe field allowlist (no `label`/`subtype`/`closedAt`/etc.
  ever present), LF-only line endings, no-fabricated-body-text, TRAIN
  feedback artifact scope/shape, historical-corpus temporal scope, private
  artifact hash integrity, `.gitignore` coverage, and `redactText` behavior.
- Extended `src/data/historicalRecords.ts` with `loadDevEvalHistoricalCorpus()`
  (reads TRAIN-only `data/train_feedback.jsonl`) and
  `loadFinalEvalHistoricalCorpus()` (reads the private TRAIN+DEV corpus).
- Extended `scripts/data-verify.ts` to additionally check the four
  materialized shared files' hashes, their exact issue-number-set match
  against the frozen manifests, and (if present locally) the private
  artifacts' hashes.
- Added `npm run data:materialize` to `package.json`.
- Extended `.gitignore` with `data/private/`.

### Data materialized (this session)

**Shared, predictor-safe (committed; label-free by construction, field set
= `number`/`title`/`body`/`createdAt`/`authorAssociation` only, matching
`EVAL_CONTRACT.md` §12.6 exactly):**

- `data/train.jsonl` — 206 records
- `data/dev.jsonl` — 66 records
- `data/final_holdout.jsonl` — 88 records
- `data/materialized_hashes.json` — SHA-256 + record count for the above
  three plus `train_feedback.jsonl`

**TRAIN-only feedback artifact (committed — TRAIN ground truth is not
subject to the DEV/FINAL privacy constraint, since TRAIN is meant to be
fully visible for learning):**

- `data/train_feedback.jsonl` — 206 records: predictor-safe fields plus the
  frozen `label`/`subtype`, `closedAt` (the "permitted post-resolution
  evidence" a rulebook/Reflector needs — explicitly excluded from
  `PredictorInput` by `EVAL_CONTRACT.md` §12.6 precisely because it's
  post-resolution, which is exactly why it belongs in a separate TRAIN-only
  artifact instead of the shared predictor-safe files), and `sourceUrl`
  (provenance: `https://github.com/modelcontextprotocol/inspector/issues/{n}`).
  Comments and linked-PR content were deliberately NOT fetched or included
  — out of scope for this session, and each carries its own leakage/PII
  risk per `EVAL_CONTRACT.md` §12.6's reasoning.

**Evaluator-private, local-only artifacts (NOT committed — excluded via
`.gitignore`; only hashes/record-counts committed, in
`data/private_artifacts_manifest.json`):**

- `data/private/dev_ground_truth.jsonl` — 66 records (DEV text joined to
  DEV's `label`/`subtype`/`closedAt` — the first place DEV's answers are
  joined to its text, hence private)
- `data/private/final_holdout_ground_truth.jsonl` — 88 records (same, for
  FINAL_HOLDOUT)
- `data/private/history_train_dev_for_final.jsonl` — 272 records (TRAIN +
  DEV, `HistoricalRecord`-shaped) — the historical-search corpus for a
  FINAL_HOLDOUT evaluation run; private for the same reason (first artifact
  joining DEV text to DEV's outcome, needed only once DEV-based iteration
  is frozen and FINAL is evaluated).

### Historical corpus policy applied (freeze)

- **DEV evaluation:** historical search may only draw on TRAIN outcomes
  (`data/train_feedback.jsonl`, loaded via `loadDevEvalHistoricalCorpus()`).
  This is structural, not just documented: the loader only ever reads the
  TRAIN-only file, so a DEV case can never see another DEV case's outcome
  as history, and DEV outcomes never become history for later DEV cases.
- **FINAL_HOLDOUT evaluation:** historical search may draw on TRAIN+DEV
  outcomes (`data/private/history_train_dev_for_final.jsonl`, loaded via
  `loadFinalEvalHistoricalCorpus()`), since both splits strictly precede
  FINAL_HOLDOUT under the frozen chronological boundaries
  (`EVAL_CONTRACT.md` §13).
- **Note on "the already-frozen FINAL corpus policy":** `EVAL_CONTRACT.md`
  does not contain a section separately named a "FINAL corpus policy" — the
  only applicable rule found was the general historical-search temporal
  constraint in §12.6 ("may only return records with `createdAt` strictly
  earlier than the issue currently being classified"). The TRAIN+DEV design
  above is this session's direct application of that general rule to
  FINAL_HOLDOUT, not a quotation of a distinct named policy. No conflict
  was found between this application and anything else in
  `EVAL_CONTRACT.md`, `PROJECT_SPEC.md`, or `IMPLEMENTATION_PLAN.md`, so
  work proceeded rather than stopping; this is flagged here explicitly so a
  human reviewer can confirm the inference rather than assume it was a
  literal quoted requirement.

### Verification performed

- `npm run env:check` — PASSED.
- `npm run data:verify` — PASSED (extended this session): frozen-manifest
  hashes OK; no split overlap; no duplicate-family contamination; all four
  materialized shared-file hashes OK; TRAIN/DEV/FINAL_HOLDOUT materialized
  issue-number sets each exactly equal their frozen manifest (zero
  extra/missing); all three private-artifact hashes OK (present in this
  worktree, since this session generated them here).
- `npm test` (vitest) — 54/54 passed (41 pre-existing + 13 new).
- `npx tsc -p tsconfig.json --noEmit` — clean, no errors.
- `npx tsx scripts/eval-dev.ts` run once, manually, with the pre-existing
  fixed placeholder predictor (`() => "RESOLVED_COMPLETED"`, unconditional
  — not a model, not inference) purely to confirm the DEV plumbing now
  executes end-to-end with `data/dev.jsonl` present (macro-F1 0.4590,
  accuracy 0.8485 — this is arithmetically the majority-class baseline on
  DEV's actual 56/10 class split, expected for a constant predictor, and is
  not a model result of any kind).
- FINAL_HOLDOUT was not evaluated, scored, or inspected for performance in
  any way this session — `data/final_holdout.jsonl` was written and
  hash-verified, and its ground truth join
  (`data/private/final_holdout_ground_truth.jsonl`) was materialized as an
  evaluator-private artifact only, never read back for scoring.

### Explicitly not done in this session

- No FINAL_HOLDOUT inference was run.
- No comments, linked PRs, or later commits were fetched for any issue —
  only `title`/`body`/`created_at`/`closed_at`/`author_association`/
  `state_reason` (the last two only for cross-checking against the frozen
  manifest, never written to a predictor-safe file).
- No push to the remote GitHub repository was performed; work is committed
  on the local AO worker branch only.
- No change to `docs/PROJECT_SPEC.md`, `docs/EVAL_CONTRACT.md`, the four
  `manifest_*.json` files, or `manifest_hashes.txt`.

### Commit produced by this session

- Branch: `ao/unwritten-syndicate-2/root`
- SHA: recorded in the handoff response returned after this ledger entry
  was committed (see `git log` on this branch for the authoritative record).
