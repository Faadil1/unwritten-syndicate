# IMPLEMENTATION_PLAN — post GATE 01B

This plan covers work to happen *after* `EVAL_CONTRACT_REVIEW_02_REQUIRED`
is cleared. Nothing in this file is authorization to start building; it is
a sequencing proposal for the next gates.

**GATE 01B revision note:** the target changed from `{bug, enhancement}`
label classification (GATE 01, rejected) to a resolution-policy target
(`ACCEPTED` vs `NOT_ACCEPTED`, GATE 01B, in force). The GATE 02 plan below
is rewritten against the new target; see PROJECT_SPEC.md §3B and
EVAL_CONTRACT.md for the full definition.

## GATE 02 (proposed): dataset materialization

- Re-run the read-only pull from EVAL_CONTRACT.md §11, this time also
  fetching issue `title` and `body` for the eligible population defined in
  EVAL_CONTRACT.md §2.2 and §4.2: 321 TRAIN / 65 DEV / 51 FINAL_HOLDOUT
  instances, labeled `ACCEPTED`/`NOT_ACCEPTED`.
- Apply the redaction/scrub policy from COMPLIANCE.md §5 item 1 before
  committing any body text.
- Run the **full-corpus duplicate/related-case reference-graph sweep**
  flagged as an open item in EVAL_CONTRACT.md §7 (the GATE 01B sweep only
  covered the 20 `DUPLICATE`-stateReason issues; `COMPLETED`/`NOT_PLANNED`
  issues referencing each other were not checked). Extend the connected
  components found and apply the same same-partition-or-exclude rule
  before freezing the dataset.
- Materialize `data/train.jsonl`, `data/dev.jsonl`,
  `data/final_holdout.jsonl` (issue number, title, body, `ACCEPTED`/
  `NOT_ACCEPTED` label, `stateReason` for diagnostics only — not as a
  model input).
- Compute and commit the literal majority-baseline (`ACCEPTED` always;
  see EVAL_CONTRACT.md §9 for the macro-F1 ≈ 0.46 reference figure on
  FINAL_HOLDOUT) and a simple keyword baseline macro-F1 on DEV, to
  sanity-check the metric contract before any agent exists.
- Re-verify the class-ratio stability claim from EVAL_CONTRACT.md §4.2 once
  full text is available — if adding title/body reveals a further
  confound not visible from labels/metadata alone, treat that as grounds
  for a GATE 01C revision rather than silently proceeding.

## GATE 03 (proposed): baseline classifier (non-agentic)

- A single-pass classifier (no memory, no reflection, no rulebook) that
  predicts `bug` vs `enhancement` from title+body, evaluated on DEV only.
- Purpose: establish a non-agentic ceiling/floor before any agentic
  machinery is justified. If a simple baseline already saturates the
  metric, that is itself an important finding to report before building
  PolicyAgent/Reflector.

## GATE 04+ (proposed, not detailed here)

- PolicyAgent design (only if GATE 03 shows headroom over baseline).
- Reflector / rulebook-memory engine design.
- Learning-round protocol (train-time iteration using DEV feedback, never
  FINAL_HOLDOUT).
- Demo UI, last, once the underlying agent is validated on FINAL_HOLDOUT
  exactly once.

## Explicit ordering constraint

FINAL_HOLDOUT (159 issues, 87 usable under the bug/enhancement taxonomy) is
evaluated at most once per major agent version, after DEV-based iteration
is frozen. Any gate that touches FINAL_HOLDOUT content for tuning purposes
invalidates the eval contract and requires re-doing GATE 01/02 with a fresh
holdout window (e.g., a later chronological slice, if new issues have
accumulated by then).
