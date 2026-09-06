# EVAL_CONTRACT — GATE 01

Status: PROPOSED. Requires human sign-off (next gate:
`EVAL_CONTRACT_REVIEW_REQUIRED`) before any dataset file is materialized or
any agent code is written.

## 1. Feasibility verdict

**FEASIBILITY: PASS**, with documented caveats (§4) that constrain scope to
a 2-class taxonomy and require explicit label-drift handling.

## 2. Source data

- Repository: `modelcontextprotocol/inspector`
- Access: `gh api graphql`, read-only, paginated, `orderBy: CREATED_AT ASC`
- Snapshot fetch date: 2026-09-06 (UTC)
- Raw pull size: 1056 issues (`docs/` does not store the raw pull; it is
  reproducible from the query in §7)

## 3. Chronological split

Split is by `createdAt` ascending over the full 1056-issue population,
70/15/15:

| split | index range | date range | issue count |
|---|---|---|---|
| TRAIN | [0, 739) | 2024-10-08T15:36:31Z → 2026-07-09T22:29:28Z | 739 |
| DEV | [739, 897) | 2026-07-09T22:29:30Z → 2026-08-07T13:49:44Z | 158 |
| FINAL_HOLDOUT | [897, 1056) | 2026-08-08T19:34:59Z → 2026-09-06T00:08:45Z | 159 |

No shuffling. FINAL_HOLDOUT is strictly the most recent 159 issues by
creation time and must not be inspected for feature/prompt engineering
decisions beyond the aggregate statistics already published in this
document.

## 4. Usable sample after taxonomy filtering

Taxonomy: `{bug, enhancement}` only (see PROJECT_SPEC.md §3). An issue is
"usable" if it carries exactly one label from `{bug, enhancement, question,
documentation, chore, refactor}` (i.e., unambiguous single taxonomy-relevant
label) AND that label is `bug` or `enhancement`. Issues with zero taxonomy
labels, multiple conflicting taxonomy labels, or a taxonomy label outside
`{bug, enhancement}` are excluded from the modeled sample.

| split | total issues | usable (bug+enhancement, single-label) | bug | enhancement | excluded (other/none/ambiguous) |
|---|---|---|---|---|---|
| TRAIN | 739 | 383 | 242 | 141 | 356 |
| DEV | 158 | 53 | 38 | 15 | 105 |
| FINAL_HOLDOUT | 159 | 87 | 68 | 19 | 72 |
| **Total** | **1056** | **523** | **348** | **175** | **533** |

Class balance is consistent in direction across all three splits
(bug > enhancement, roughly 2:1 to 3.5:1), which is the main basis for the
PASS verdict — the *chosen* 2-class taxonomy does not exhibit the drift
described in §5.

## 5. Leakage / drift risks discovered

1. **Label-completeness drift (do not treat as a stable base rate).**
   Fraction of issues carrying *any* taxonomy-relevant label (the six-label
   superset, before restricting to bug/enhancement) is 54% in TRAIN (399/739),
   40% in DEV (61/158), and 97% in FINAL_HOLDOUT (145/159). This is almost
   certainly a triage-lag / bulk-relabeling artifact, not a change in the
   nature of incoming issues. Consequence: FINAL_HOLDOUT looks artificially
   "cleaner" than DEV. Mitigation adopted: restrict the modeled taxonomy to
   `{bug, enhancement}`, which is present at comparable relative density
   across splits (52%/72% of usable-among-labeled in each split); still,
   any reported holdout metric must be accompanied by this caveat and must
   not be compared to DEV metrics as if label-completeness were constant.

2. **`chore` label spike concentrated in FINAL_HOLDOUT.** 47 of 63 total
   `chore` labels in the entire repo (75%) fall inside the FINAL_HOLDOUT
   window alone, vs. 1 in TRAIN and 5 in DEV. This is a strong non-stationary
   signal consistent with a recent bulk-labeling pass or bot policy change.
   `chore` is excluded from the modeled taxonomy specifically because of this
   drift (not just its low volume).

3. **Version-migration labels (`v1`/`v2`, `closed-v1-deprecated`) correlate
   with time, not issue content.** `v2` alone touches 504/1056 issues (48%)
   and is a repository-migration marker. These are excluded from both
   features and labels to avoid the model (or the eval) picking up a
   "when was this filed" shortcut disguised as a content signal.

4. **Multi-label ambiguity.** 511/1056 issues (48%) carry more than one
   label overall; 15 issues carry more than one *taxonomy-relevant* label
   simultaneously (e.g., `chore+refactor` ×10, `bug+documentation` ×3).
   These are dropped from the usable sample rather than arbitrarily
   assigned a primary label, to avoid injecting a silent labeling policy
   of our own into the ground truth.

5. **Untriaged issues are not confirmed negatives.** 436/1056 issues (41%)
   carry none of the six taxonomy-relevant labels. This is very likely
   backlog/untriaged state, not evidence the issue is neither a bug nor an
   enhancement. These issues are excluded, not treated as a third class.

6. **Potential near-duplicate content across splits.** The repo has 9
   issues explicitly labeled `duplicate`. Because splits are purely
   chronological, a duplicate/original pair could land in different splits
   (e.g., original in TRAIN, duplicate in DEV or FINAL_HOLDOUT), which would
   let a memorization-style model leak train content into eval. This gate
   does not resolve this (would require pulling issue bodies and doing
   near-duplicate detection); it is flagged for the implementation gate as
   an open risk, not yet mitigated.

7. **No issue body/title text has been pulled yet in this gate.** All
   analysis above is on labels/timestamps only. Any content-based leakage
   (e.g., an issue explicitly referencing a future issue number, or
   templated text that changed over time) is unverified until body text is
   retrieved under a future gate.

## 6. Metric contract (proposed, not yet implemented)

- Primary metric: macro-F1 over `{bug, enhancement}` on FINAL_HOLDOUT.
- DEV is for iteration/threshold tuning only; FINAL_HOLDOUT is touched
  exactly once, after DEV-based decisions are frozen.
- Given class imbalance (~2:1 bug:enhancement in TRAIN, ~3.5:1 in
  FINAL_HOLDOUT), accuracy alone is not an acceptable headline metric.
- Baseline to beat: majority-class predictor (predict `bug` always) —
  yields 68/87 = 78.2% accuracy but 0% recall on `enhancement`, macro-F1
  ≈ 0.44 on FINAL_HOLDOUT as computed from the counts in §4. Any real
  agent must exceed this macro-F1 baseline, not just accuracy.

## 7. Reproducibility

Query used to pull the raw data (read-only, paginated):

```
gh api graphql --paginate -f query='
query($endCursor: String) {
  repository(owner: "modelcontextprotocol", name: "inspector") {
    issues(first: 100, after: $endCursor, orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        state
        createdAt
        closedAt
        labels(first: 10) { nodes { name } }
      }
    }
  }
}' --jq '.data.repository.issues.nodes[]'
```

No raw data file is committed in this gate. Materializing
`data/train.jsonl` / `data/dev.jsonl` / `data/final_holdout.jsonl` (issue
number + label only, or + body text pending compliance review) is deferred
to the implementation gate, after this contract is reviewed.

## 8. Next gate

`EVAL_CONTRACT_REVIEW_REQUIRED`
