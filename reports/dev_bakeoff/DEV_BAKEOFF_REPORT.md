# SESSION E — Real-Model DEV Bakeoff (A0/A1/A2/A3)

## Gate classification: `BLOCKED`

**Reason: `MODEL_CREDENTIAL_REQUIRED`** — no authorized real-model route was
available in this environment, so no real-model DEV inference was executed
for any of A0/A1/A2/A3. Per the task's hard lock ("If no authorized
real-model route is available, STOP with `MODEL_CREDENTIAL_REQUIRED` ...
Do not substitute the placeholder predictor"), this session did not run the
full 66-item DEV bakeoff and does not report any Macro-F1/accuracy/
confusion-matrix numbers for A0/A1/A2/A3.

## What was verified before hitting the blocker

### 1. Repository / lineage
- Repository confirmed as `Faadil1/unwritten-syndicate`.
- Working tree was clean at session start.
- All four required Session D commits were locally reachable:
  `8990a0b`, `5fa6eb8`, `1838b4a`, `1962695`, on top of base `6790ecd`.
- The worker branch (`ao/unwritten-syndicate-6/root`) HEAD was already an
  ancestor of `1962695`, and the four commits formed the exact linear chain
  required — so integration was a fast-forward merge to `1962695` rather
  than a cherry-pick (identical resulting tree/history for this case).

### 2. Baseline verification suite
- `npm test` — 151/151 passed (150 passed + 1 pre-existing skip), 20 test files.
- `npm run data:verify` — PASSED: frozen manifest hashes OK, TRAIN=206 /
  DEV=66 / FINAL_HOLDOUT=88, no split overlap, no duplicate-family
  contamination, all shared materialized-file hashes OK, all three
  issue-number sets exactly match their frozen manifests.
- `npm run typecheck` — clean, no errors.

### 3. DEV ground truth (private, evaluator-only)
`data/private/dev_ground_truth.jsonl` was **not** present in this fresh
worktree. The existing full materializer
(`scripts/materialize-dataset.ts`) joins TRAIN, DEV, **and**
FINAL_HOLDOUT in a single run and would have written FINAL_HOLDOUT's
private ground truth as a side effect — disallowed by this session's hard
lock. Per the task's fallback instruction ("If the existing materializer
cannot produce DEV-only private truth without touching FINAL, add the
smallest evaluator-only DEV-only path"), a new script was added:

- **`scripts/materialize-dev-ground-truth.ts`** — loads *only* the frozen
  DEV manifest (`loadGroundTruth("DEV")`), reuses the existing read-only,
  unauthenticated, paginated GitHub REST listing (`fetchAllIssues()`,
  refactored to be importable) purely to stay inside the unauthenticated
  60 req/hour rate limit, joins only the 66 DEV issue numbers, and writes
  only `data/private/dev_ground_truth.jsonl`. It never calls
  `loadGroundTruth("FINAL_HOLDOUT")` and never writes a "final" artifact.
  `scripts/materialize-dataset.ts`'s own `main()` was guarded behind an
  entrypoint check so importing its helpers can no longer trigger the full
  TRAIN+DEV+FINAL_HOLDOUT run as an import side effect.

Result:
- **Record count: 66** (exactly matches the frozen DEV manifest — verified
  by the script itself, which throws if the count is not exactly 66).
- **SHA-256: `87ca7ce7dfc7f722d85b67a6a864427815211a5bb04c3c92f12abe7c53524c41`**
- This hash is **byte-identical** to the hash already committed (from a
  prior session) in `data/private_artifacts_manifest.json`'s
  `dev_ground_truth.jsonl` entry — i.e. the underlying GitHub issue text
  for all 66 DEV issues has not drifted, and reconstruction is exactly
  reproducible.
- File remains local-only, gitignored (`data/private/` — verified via
  `git check-ignore` and the existing `.gitignore` test).
- FINAL_HOLDOUT ground truth was **not** read, joined, materialized, or
  inspected at any point. `data/private/final_holdout_ground_truth.jsonl`
  and `data/private/history_train_dev_for_final.jsonl` do not exist in
  this checkout; `private_artifacts_manifest.json`'s entries for those two
  files are untouched (byte-identical `git diff`).

  `src/data/materializedHashes.ts` and `scripts/data-verify.ts` previously
  assumed private-artifact materialization was all-or-nothing (3 files
  together) and would hard-fail on this legitimate DEV-only partial state.
  This was fixed minimally: a present-but-missing private file is now
  reported as `SKIP` (not yet materialized) rather than `FAIL`; only a file
  that exists on disk with a mismatching hash still fails the check. The
  corresponding test (`tests/data/materialization.test.ts`) was updated to
  match. Re-ran `npm test` / `npm run data:verify` / `npm run typecheck`
  after this change — all still pass (see updated counts below).

### 4. Real model route (the blocker)
Checked in the required priority order:
1. **Existing repository/provider configuration** — none found. No `.env`,
   no credentials file, no provider SDK dependency in `package.json`
   (only `@types/node`, `tsx`, `typescript`, `vitest`), no client wiring
   for any LLM API anywhere in `src/` or `scripts/`.
2. **`ANTHROPIC_API_KEY`** — not present in the process environment.
3. **Any other already-authorized provider** — none found in the repo or
   environment.

**No authorized real-model route is available.** Per the task's explicit
instruction, the placeholder predictor was **not** substituted as a stand-in
for a real model, and the four causal conditions were **not** run as a
scored 66-item benchmark. The pre-existing plumbing script
(`npm run eval:dev:bakeoff`) was run once purely to re-confirm wiring
health (see below) — its output is explicitly self-labeled by the script as
`PLACEHOLDER PREDICTOR ... NOT a benchmark result` and is reported here only
as an operational/wiring fact, not a metric.

**Required to unblock:** set `ANTHROPIC_API_KEY` in the environment (or wire
an equivalent already-authorized model provider into this repository), then
re-run this session's task so the frozen model/prompt/parser configuration
can be recorded and the real 66-item A0/A1/A2/A3 run can execute.

### 5. Plumbing wiring check (non-scored, non-model)
`npm run eval:dev:bakeoff` (Session D's existing placeholder-predictor
harness) was run once to confirm all four causal conditions are wired and
deterministic ahead of a real model route becoming available:

| Condition | scored | errored | total |
|---|---|---|---|
| A0 cold | 66 | 0 | 66 |
| A1 raw-RAG | 66 | 0 | 66 |
| A2 scrambled-rulebook | 66 | 0 | 66 |
| A3 learned-rulebook | 66 | 0 | 66 |

- TRAIN-only historical corpus size: 206 (`data/train_feedback.jsonl`).
- Frozen retrieval top-k shared by A1 and A3: **5** (`DEV_HISTORICAL_SEARCH_TOP_K`).
- Real V3 active rules (A3): **12** (≤ `MAX_ACTIVE_RULES = 15`).
- A2 scrambled V3 rules: **12** (same count as A3 — structure/budget preserved).
- This run wrote nothing under `memory/` (verified by SHA-256 of
  `memory/V0.json`..`V3.json` before and after — unchanged).

This confirms the A0/A1/A2/A3 harness, retrieval config, and Rulebook
snapshot are ready to accept a real model decision function with no
plumbing changes needed once a route is authorized.

## A0/A1/A2/A3 metrics table

Not produced. No real-model inference was run (see Gate classification
above). See `metrics.json` for the machine-readable BLOCKED record.

## Deltas

Not computable — no real-model results exist for any condition this
session.

## Historical context (not a result of this session)

A prior, non-canonical GATE 01C manual hardness probe
(`docs/EVAL_CONTRACT.md` §12.5,
`data/gate01c_manifests/dev_cold_baseline_results.json`) recorded
**macro-F1 0.6042** on DEV using a fixed manual classification heuristic
applied by a human/LLM reviewer reading title + partial body, not this
repository's A0/A1/A2/A3 predictor harness. It predates and is unrelated to
this session's infrastructure. It is included here only as historical
context, per the task's explicit instruction, and must not be conflated
with or presented as a canonical A0/A1/A2/A3 result.

## Integrity checks

- `npm test` — 151/151 passed (20 test files) after all changes.
- `npm run data:verify` — PASSED after all changes (private-artifact
  section now shows `OK` for `dev_ground_truth.jsonl` and `SKIP` for the
  two FINAL_HOLDOUT-related private artifacts, which are legitimately
  absent).
- `npm run typecheck` — clean.
- `memory/V0.json` / `V1.json` / `V2.json` / `V3.json` — SHA-256 identical
  before and after every command run this session (including the plumbing
  smoke test); `git diff --stat memory/` reports no changes. DEV never
  updated Rulebook memory.
- FINAL_HOLDOUT: never read, scored, inferred, materialized, inspected,
  fetched, or generated as ground truth this session. No FINAL evaluation
  path was run.

## Blockers / risks

- **Blocker:** `MODEL_CREDENTIAL_REQUIRED` — no `ANTHROPIC_API_KEY` and no
  other authorized model-provider route present in this VM/repository.
  Resolving this requires a human to supply credentials; it is not
  something this session can create or request from within the sandbox.
- **Risk (informational, not a defect):** `scripts/materialize-dataset.ts`
  still performs a combined TRAIN+DEV+FINAL_HOLDOUT materialization when
  run directly (`npm run data:materialize`) — that is intentional, existing
  Session A2 behavior for a full fresh setup, and was left unchanged.
  Anyone re-running this session's work should use
  `npm run data:materialize:dev-only` (new) instead of
  `npm run data:materialize` if the FINAL_HOLDOUT lock still applies.

## Next step

Provide `ANTHROPIC_API_KEY` (or another already-authorized model route) in
the environment, then re-run the SESSION E task. All non-model
infrastructure (lineage, tests, DEV ground truth, retrieval config,
Rulebook snapshot, harness wiring) is verified ready; only the model call
itself is missing.
