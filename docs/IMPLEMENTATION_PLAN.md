# IMPLEMENTATION_PLAN — post GATE 01

This plan covers work to happen *after* `EVAL_CONTRACT_REVIEW_REQUIRED` is
cleared. Nothing in this file is authorization to start building; it is a
sequencing proposal for the next gates.

## GATE 02 (proposed): dataset materialization

- Re-run the read-only pull from EVAL_CONTRACT.md §7, this time also
  fetching issue `title` and `body` for the 523 usable issues identified
  in EVAL_CONTRACT.md §4 (plus enough surrounding context to do the
  near-duplicate check from §5 item 6).
- Apply the redaction/scrub policy from COMPLIANCE.md §5 item 1 before
  committing any body text.
- Materialize `data/train.jsonl`, `data/dev.jsonl`,
  `data/final_holdout.jsonl` (issue number, title, body, label only).
- Run near-duplicate detection across splits; if leakage is found, either
  drop the offending FINAL_HOLDOUT/DEV items or document accepted residual
  risk explicitly.
- Compute and commit the literal majority-baseline and a simple
  bag-of-words/keyword baseline macro-F1 on DEV, to sanity-check the
  metric contract before any agent exists.

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
