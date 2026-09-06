# IMPLEMENTATION_PLAN — post GATE 01C (FINAL BENCHMARK FREEZE)

This plan covers work to happen *after* `FINAL_BENCHMARK_FREEZE_REVIEW_REQUIRED`
is cleared. Nothing in this file is authorization to start building; it is
a sequencing proposal for the next gates.

**Revision history:**
- GATE 01B: target changed from `{bug, enhancement}` label classification
  (GATE 01, rejected) to a resolution-policy target (`ACCEPTED` vs
  `NOT_ACCEPTED`).
- GATE 01C (this revision): classes renamed to `RESOLVED_COMPLETED` /
  `RESOLVED_NO_NEW_WORK`; a maturity/censoring control and a moved T2
  boundary were applied; a full-corpus duplicate sweep excluded 14
  contaminated instances; a real cold baseline was run on DEV
  (macro-F1 0.60); split manifests were frozen with SHA-256 hashes at
  `data/gate01c_manifests/`. The GATE 02 plan below is rewritten against
  the frozen benchmark; see `docs/EVAL_CONTRACT.md` §12–§15 for the
  authoritative definition.

## GATE 02 (proposed): dataset materialization

- Load the frozen manifests directly — `data/gate01c_manifests/manifest_train.json`
  (206 issues), `manifest_dev.json` (66), `manifest_final_holdout.json`
  (88) — rather than re-deriving the split. Re-deriving from scratch risks
  silently drifting from the frozen boundaries; the manifests are the
  source of truth as of GATE 01C.
- For each issue number in the manifests, fetch `title` and `body` only
  (per the frozen predictor input contract, EVAL_CONTRACT.md §12.6 — do
  **not** fetch or store labels, milestone, assignee, comments, linked
  PRs, or later commits as model input; `stateReason`/`subtype` is already
  in the manifest as the label, not as a feature).
- Apply the redaction/scrub policy from COMPLIANCE.md §5 item 1 before
  committing any body text.
- Materialize `data/train.jsonl`, `data/dev.jsonl`,
  `data/final_holdout.jsonl` (issue number, title, body,
  `RESOLVED_COMPLETED`/`RESOLVED_NO_NEW_WORK` label, `subtype` for the
  evaluator-only diagnostic in EVAL_CONTRACT.md §12.7 — never as a model
  input).
- Verify the materialized files' issue-number sets match the frozen
  manifests exactly (a simple set-equality check) before proceeding —
  this catches any accidental drift from re-fetching.
- Compute and commit the literal majority-baseline (`RESOLVED_COMPLETED`
  always) on FINAL_HOLDOUT for the record (macro-F1 ≈ 0.46 by the same
  arithmetic as EVAL_CONTRACT.md §9, recomputed against the final 88/73/15
  counts in §12.8 — do this arithmetic once GATE 02 starts, do not reuse
  the GATE 01B figure verbatim since the denominator changed).
- The GATE 01C cold baseline (macro-F1 0.6042 on DEV, §12.5) is already
  the reference non-agentic ceiling/floor for DEV — GATE 03's baseline
  classifier should be compared against it directly rather than re-deriving
  a new cold baseline from scratch.

## GATE 03 (proposed): baseline classifier (non-agentic)

- A single-pass classifier (no memory, no reflection, no rulebook) that
  predicts `RESOLVED_COMPLETED` vs `RESOLVED_NO_NEW_WORK` from title+body
  only (per the frozen input contract), evaluated on DEV only.
- Purpose: establish a reproducible, automated non-agentic ceiling/floor
  before any agentic machinery is justified, and compare it against the
  GATE 01C manual cold baseline (macro-F1 0.6042) — if an automated
  zero-history baseline already approaches or exceeds ~0.90 macro-F1, that
  is a hardness-warning event requiring review before proceeding (per the
  interpretation rule in EVAL_CONTRACT.md §12.5), even though the manual
  GATE 01C baseline did not trigger it.
- Report per-class precision/recall/F1 and the confusion matrix in the same
  format as `data/gate01c_manifests/dev_cold_baseline_results.json`, so the
  two are directly comparable.

## GATE 04+ (proposed, not detailed here)

- PolicyAgent design (only if GATE 03 shows headroom over baseline).
- Reflector / rulebook-memory engine design. Any historical-search
  capability must obey the frozen constraint in EVAL_CONTRACT.md §12.6:
  it may only return records with `createdAt` strictly earlier than the
  issue currently being classified.
- Learning-round protocol (train-time iteration using DEV feedback, never
  FINAL_HOLDOUT).
- Demo UI, last, once the underlying agent is validated on FINAL_HOLDOUT
  exactly once.
- Secondary diagnostic reporting: recall on the `DUPLICATE` subtype within
  `RESOLVED_NO_NEW_WORK` (EVAL_CONTRACT.md §12.7), to show whether learning
  helps duplicate-recognition specifically versus scope/priority-rejection
  judgment generally.

## Explicit ordering constraint

FINAL_HOLDOUT (88 issues, 73 `RESOLVED_COMPLETED` / 15
`RESOLVED_NO_NEW_WORK`, frozen per EVAL_CONTRACT.md §12.8/§13) is evaluated
at most once per major agent version, after DEV-based iteration is frozen.
**Per the GATE 01C freeze record, FINAL_HOLDOUT composition must not be
modified based on any model's performance from this point forward.** Any
gate that touches FINAL_HOLDOUT content for tuning purposes invalidates the
eval contract and requires a new, explicitly numbered gate (e.g. GATE 01D)
with a fresh holdout window (a later chronological slice, once enough new
issues have accumulated and matured past the 60-day lag), not a silent
edit to the existing manifest.
