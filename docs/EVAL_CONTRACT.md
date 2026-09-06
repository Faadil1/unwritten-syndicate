# EVAL_CONTRACT — GATE 01B (supersedes GATE 01 taxonomy choice)

Status: PROPOSED. Requires human sign-off (next gate:
`EVAL_CONTRACT_REVIEW_02_REQUIRED`) before any dataset file is materialized
or any agent code is written.

**Revision history:**
- GATE 01: proposed `{bug, enhancement}` label-classification target. REJECTED
  at review — see §0 below for why, kept for the record.
- GATE 01B (this revision): proposes a resolution-policy target instead,
  after hardness testing three candidates and auditing for lexical/temporal
  leakage and cross-split duplication.

## 0. Rejected candidate from GATE 01 — `{bug, enhancement}` label classification

**Verdict at GATE 01B: REJECTED, kept for record, not deleted.**

Original analysis (unchanged from GATE 01):

Taxonomy: `{bug, enhancement}`, single-label only. An issue is "usable" if
it carries exactly one label from `{bug, enhancement, question,
documentation, chore, refactor}` and that label is `bug` or `enhancement`.

| split | total issues | usable (bug+enhancement, single-label) | bug | enhancement | excluded (other/none/ambiguous) |
|---|---|---|---|---|---|
| TRAIN | 739 | 383 | 242 | 141 | 356 |
| DEV | 158 | 53 | 38 | 15 | 105 |
| FINAL_HOLDOUT | 159 | 87 | 68 | 19 | 72 |
| **Total** | **1056** | **523** | **348** | **175** | **533** |

**Why it was rejected (per human review):** predicting `bug` vs
`enhancement` from an issue's own text is a generic semantic-classification
task. GitHub issue templates make the answer largely explicit at
creation time (structured "Describe the bug" / "Expected vs Actual
Behavior" sections for bug reports vs. "Feature Request:" / "Proposal:"
language for enhancements). A strong cold LLM can plausibly solve most of
this from the text alone, without ever learning anything specific about how
`modelcontextprotocol/inspector` maintainers operate. That would make a
V0→V3 "the agent learned this team's history" narrative unconvincing,
because the ceiling is already near-reachable by a generic model. The
underlying label-completeness drift documented in the original analysis
(§0.1 below) is also carried into the new target's drift investigation
(§8), since it turned out to share a root cause.

Original drift/leakage notes are preserved below for traceability:

### 0.1 Original leakage/drift risks (GATE 01 finding, root-caused in §8 of this document)

1. Label-completeness drift: 54% of TRAIN issues carried any of the six
   taxonomy-relevant labels, vs. 40% of DEV, vs. 97% of FINAL_HOLDOUT.
2. `chore` label spike: 47 of 63 total `chore` labels fall inside the old
   FINAL_HOLDOUT window alone.
3. `v1`/`v2` version-migration labels correlate with time, not content
   (see §3 of the hardness test below — this generalizes to full rejection
   of version-routing as a target, not just as a feature).
4. Multi-label ambiguity: 511/1056 issues carry more than one label.
5. 436/1056 issues (41%) carry none of the six taxonomy labels — untriaged,
   not confirmed negatives.
6. Potential near-duplicate content across splits was flagged but not
   investigated in GATE 01. It is investigated properly in §7 of this
   revision.

## 1. Feasibility verdict

**BENCHMARK VERDICT: PASS** — a defensible, harder, policy-specific target
exists in `modelcontextprotocol/inspector` without needing to change
repositories. Repository/data-availability feasibility (confirmed already
in GATE 01) still holds.

## 2. Selected operational decision target

**Target: "Will an externally-reported issue be independently actioned by
the maintainers, or will it be resolved without dedicated new work?"**

This is a genuine team-scope/priority/institutional-memory decision:
knowing whether an issue duplicates prior work requires knowing the
project's issue history; knowing whether a reasonable-sounding request is
"not planned" requires knowing the team's actual roadmap and prior
scope decisions, which are not written into the reporting issue itself.

### 2.1 Ground-truth definition

Source field: GitHub's native `stateReason` on a closed issue (values
observed in this repo: `COMPLETED`, `NOT_PLANNED`, `DUPLICATE`, plus
`REOPENED` and `null`/open for unresolved issues). This is the
maintainers' own recorded resolution decision — durable, queryable,
reproducible via the GitHub GraphQL API, and not something we are
inferring or re-labeling ourselves.

- **`ACCEPTED`** = `stateReason == COMPLETED`
- **`NOT_ACCEPTED`** = `stateReason ∈ {NOT_PLANNED, DUPLICATE}`

`NOT_PLANNED` (team decided not to act — out of scope, wontfix, disagreed
with) and `DUPLICATE` (already covered by other work) are collapsed into
one class because both represent "no independent action will be taken on
this specific report," which is the operationally meaningful boundary a
triage agent needs to predict. (A 3-class variant keeping `DUPLICATE`
separate was evaluated and rejected for this gate — see §4.4.)

### 2.2 Eligibility filters (defined at issue-creation time or from durable, non-outcome metadata — none of these filters leak the label)

An issue is **eligible** for the modeled population if ALL of the
following hold:

1. **External authorship.** `authorAssociation ∈ {NONE, FIRST_TIME_CONTRIBUTOR, CONTRIBUTOR}`
   (i.e. not `OWNER`/`MEMBER`/`COLLABORATOR`). This field is known the
   instant the issue is opened — using it to *scope* the population does
   not leak the outcome. It is required because internal/maintainer-authored
   issues are near-automatically `COMPLETED` (see §8.1) — including them
   would let a model win purely by detecting authorship/format, not by
   learning team judgment.
2. **Not an administrative version-migration purge.** Issue does not carry
   label `closed-v1-deprecated` or `closed-v1-security-declined`. These
   mark issues closed by a bulk migration sweep, not a case-by-case
   decision (see §8.2). Labels are attached over an issue's lifetime, but
   these two specifically mark an administrative *reason class* distinct
   from ordinary triage, so excluding on them removes a process artifact,
   not a content signal.
3. **Resolved with an eligible stateReason.** `stateReason ∈ {COMPLETED, NOT_PLANNED, DUPLICATE}`.
   Open, unresolved, or `REOPENED` issues are excluded as **right-censored**
   (see §5) — a currently-open issue has not yet received a team decision
   and must not be treated as an implicit `ACCEPTED`.

## 3. Hardness test — all candidates considered

### Candidate A: Resolution policy (SELECTED, refined per §2)

- Classes (raw, before collapsing): `COMPLETED` (795), `NOT_PLANNED` (205),
  `DUPLICATE` (20), open/unresolved (36) — out of 1056 total issues.
- Class imbalance (raw): heavily skewed toward `COMPLETED` (78% of
  resolved issues).
- **Explicit leakage found on first pass:** `authorAssociation` is a
  massive confound. `MEMBER`-authored issues resolve `COMPLETED` 424/465
  times (91%); `NONE`-authored (true external/first-time) issues resolve
  `COMPLETED` only 302/486 times (62%), with real contested outcomes
  (`NOT_PLANNED` 168, `DUPLICATE` 16). A cold model could get most of its
  accuracy just by detecting "this reads like an internal roadmap/tracking
  issue" (structured `## Summary`, cross-references to existing PRs,
  "Tracking issue" phrasing) rather than judging the request's merits.
  **Mitigation: restrict to external authorship (§2.2.1).**
- **Second confound found:** a bulk `closed-v1-deprecated` migration purge
  on 2026-08-01 closed 56 issues as `NOT_PLANNED` in a single day,
  dominating what would otherwise have been the DEV split's `NOT_PLANNED`
  count (56 of 61). This is an administrative event, not per-issue
  judgment. **Mitigation: exclude purge-labeled issues (§2.2.2).**
- After both mitigations, class ratios stabilize across TRAIN/DEV/HOLDOUT
  (see §4) — evidence the remaining signal is closer to a real, stable
  team-judgment policy rather than an artifact of authorship mix or a
  one-time administrative sweep.
- Temporal leakage risk: low, once the purge is excluded (§8 traces the
  root cause and confirms no other comparable sweep exists in-window).
- Policy drift risk: residual risk remains that maintainer standards for
  "not planned" vs "completed" shift gradually over ~2 years; not fully
  ruled out, flagged as an open monitoring item for future gates.
- Ground-truth reliability: high — `stateReason` is a first-class GitHub
  field set directly by maintainers on close, not inferred by us.
- Could a generic cold LLM solve this without repo history? **No, not
  reliably** — see §6 cold-baseline audit. Well-formed, plausible-sounding
  external requests get rejected (`NOT_PLANNED`) and well-formed bug
  reports get marked `DUPLICATE` with no lexical self-disclosure in the
  reporting text itself.
- Why repository history would materially help: to predict `DUPLICATE`, an
  agent must know a similar issue was already filed/fixed. To predict
  `NOT_PLANNED` vs `ACCEPTED` on a well-formed, reasonable-sounding request,
  an agent must know this team's actual scope boundaries and priorities as
  established by prior decisions — information that is not present in the
  new issue's own text.

### Candidate B: Release/version routing (`v1` vs `v2`) — REJECTED

- `v1` label: 144 issues, date range 2025-04-03 → 2026-08-24.
  `v2` label: 504 issues, date range 2025-03-07 → 2026-09-06. The two
  labels technically co-occur across a wide overlapping window, so this
  does not fail on a strict "calendar time alone" technicality — but:
- **Explicit, severe lexical leakage.** Sampled issue bodies almost always
  state the version directly in the reporter's own template answer, e.g.
  *"Which version line? v2 — current"* or *"Inspector Version 1.0.0"*
  (observed verbatim in sampled issues #1734, #1893, #1911, #1918, #1931,
  #1938 — see §6 sample). This is answer-in-the-question: routing by
  version when the version is a literal template field the reporter fills
  in is not an operational-judgment task at all.
- Rejected without needing a full count table — the leakage is decisive
  and structural, not a matter of degree.

### Candidate C: Ownership/subsystem routing (`auth`, `cli`, `windows`, `containerization`, `keyring`) — REJECTED

- Combined volume across all five subsystem labels: 143 label-instances
  total on 1056 issues — too sparse to support a stable multi-class
  chronological split (some subsystems would have single-digit DEV/HOLDOUT
  counts).
- Lexical leakage is also severe by inspection: these labels correspond to
  subsystem names that reporters overwhelmingly name explicitly in the
  title (e.g. "OAuth ...", "CLI --log-level ...", "Docker container...",
  "keyring" / "windows" in bug templates' environment fields).
- Rejected on both insufficient volume and structural leakage; not pursued
  further given Candidate A already passes.

## 4. Eligible counts by split (Candidate A, final, after §2.2 filters and §7 duplicate-group exclusion)

### 4.1 Boundaries and raw eligible counts (before duplicate-group exclusion)

Population: 459 issues satisfy §2.2.1–§2.2.2 (external authorship,
non-purge) out of 1056 total.

| split | date range (UTC) | total in split | ACCEPTED (`COMPLETED`) | NOT_ACCEPTED (`NOT_PLANNED`+`DUPLICATE`) | censored (open/reopened, excluded) |
|---|---|---|---|---|---|
| TRAIN | 2024-11-25T23:40:07Z → 2025-11-24T11:00:30Z | 321 | 271 | 50 (39+11) | 0 |
| DEV | 2025-12-02T03:22:41Z → 2026-07-29T17:33:19Z | 69 | 53 | 15 (12+3) | 1 |
| FINAL_HOLDOUT | 2026-07-29T20:09:58Z → 2026-09-05T20:41:42Z | 69 | 44 | 10 (6+4) | 15 |

### 4.2 After duplicate-group cross-split exclusion (§7) — FINAL eligible counts

One connected duplicate cluster (the "platform storage / keyring
PermissionDenied" bug, issues #1845/#1848/#1852 in DEV and
#1918/#1931/#1938 in FINAL_HOLDOUT — all about the same underlying defect)
spans the DEV/FINAL_HOLDOUT boundary and is excluded from evaluation
entirely per the duplicate-protection rule (§7).

| split | ACCEPTED | NOT_ACCEPTED | **total eligible for eval** |
|---|---|---|---|
| **TRAIN** | 271 | 50 | **321** |
| **DEV** | 51 (53−2) | 14 (15−1) | **65** |
| **FINAL_HOLDOUT** | 44 | 7 (10−3) | **51** |

Class imbalance: TRAIN 84%/16%, DEV 78%/22%, FINAL_HOLDOUT 86%/14% —
directionally consistent (`ACCEPTED` majority throughout, no split flips
the majority class), which is the key stability evidence supporting the
PASS verdict.

### 4.3 Note on sample size

FINAL_HOLDOUT `NOT_ACCEPTED` count (7) is small. This is an accepted
tradeoff per the explicit instruction to prefer "a harder, more
policy-specific 2–3 class target over an easy generic 5-class target" and
"do not choose a task merely because it has more samples." Metric
reporting (§9) must present per-class counts alongside any aggregate score
so a macro-F1 number is never read without its denominator.

### 4.4 Why the 3-class variant (keeping `DUPLICATE` separate) was not selected

Keeping `DUPLICATE` as its own class was seriously considered — it is
arguably the single hardest, most history-dependent sub-case (see §6). It
was not selected as the primary target because after external-author and
purge filtering, only 18 `DUPLICATE` instances remain total (11 TRAIN / 3
DEV / 4 HOLDOUT, before the §7 exclusion drops it to 11/2/1) — too thin for
a reliable third class in DEV/HOLDOUT. It is retained as a documented,
explicitly-flagged sub-case inside `NOT_ACCEPTED` rather than discarded:
future gates may report `DUPLICATE` recall within `NOT_ACCEPTED` as a
secondary diagnostic metric even though it is not the primary eval axis.

## 5. Censoring

An issue that is still `OPEN` (or `REOPENED`) at snapshot time has not yet
received a team decision. Treating it as an implicit `ACCEPTED` (or any
other class) would be incorrect — it is right-censored, not resolved. This
project's fixed **observation horizon is the snapshot fetch time itself
(2026-09-06T00:08:45Z, i.e. the `createdAt` of the last issue pulled)**:
any issue open at that instant is excluded from the eligible population,
full stop, regardless of how "obviously" it looks likely to be accepted or
rejected. This affects FINAL_HOLDOUT disproportionately (15 of 69 in-window
issues censored, 22%) simply because recent issues have had less time to
resolve — this is expected right-censoring by recency, not a labeling-
process artifact, and is distinct from the drift investigated in §8.

## 6. Cold-baseline / lexical-leakage sanity audit (DEV only)

**Fixed, predeclared DEV sample used (25 issue numbers, drawn before any
manual reading occurred):**

`1632, 1633, 1636, 1639, 1640, 1642, 1643, 1645, 1646, 1661, 1677, 1684,
1687, 1734, 1741, 1802, 1893, 1911, 1916, 1933, 1845, 1855, 1918, 1931,
1938`

(First 10 = first-encountered `COMPLETED` in the original unfiltered DEV
window; remaining = all `NOT_PLANNED` and all `DUPLICATE` in that same
window. This sample predates the discovery of the authorship confound —
its composition is exactly what *exposed* that confound, documented
honestly below rather than replaced with a cleaner-looking sample after
the fact.)

**Findings from reading title + first ~200 chars of body for all 25:**

- The 10 sampled `COMPLETED` issues (#1632, #1633, #1636, #1639, #1640,
  #1642, #1643, #1645, #1646, #1661) are overwhelmingly maintainer-style
  roadmap/tracking issues: `## Summary`, "Tracking issue", explicit
  cross-references to existing PRs/phases, v1→v2 migration engineering
  work. **This is exactly the authorship leak documented in §3/§8.1** — a
  cold model could plausibly learn "structured internal roadmap format ⇒
  COMPLETED" without any repository-history reasoning. This is precisely
  why §2.2.1 restricts the eligible population to external authorship.
- The `NOT_PLANNED` sample (#1677, #1684, #1687, #1734, #1741, #1802,
  #1893, #1911, #1916, #1933) is dominated by well-formed, reasonable
  external requests: e.g. #1684 "configure a custom proxy" (analogous to a
  standard curl flag), #1741 "Custom transport (and static website)",
  #1911 "Opt-in OAuth HTTP exception for trusted local development hosts",
  #1916 "optional machine-readable readiness summary." None of these
  contain self-disqualifying language ("not sure this fits," "probably out
  of scope," etc.) — a generic reader would likely judge several of them
  as plausible, mergeable feature requests. Their rejection reflects the
  maintainers' actual scope/priority boundaries, not something legible
  from the text alone.
- The `DUPLICATE` sample (#1845, #1855, #1918, #1931, #1938) are all
  standard, well-formed bug reports (structured "Describe the bug" /
  "Which version line?" templates) with **no explicit self-reference to
  being a duplicate anywhere in the sampled text**. Detecting these
  requires matching against prior issue history — exactly the capability
  the Unwritten agent is meant to demonstrate.
- No fixed zero-shot model call was executed in this gate (no agent code
  is permitted yet, per GATE 01B instructions); the audit above is a
  manual, text-only lexical-cue review of the predeclared sample, which is
  what surfaced the authorship confound before any modeling work began.

**Conclusion:** on the *external-authorship-restricted* population (i.e.
excluding the 10 leaky `COMPLETED` samples above, which are all
internal/maintainer-authored and therefore already excluded from the
modeled population by §2.2.1), the remaining `NOT_PLANNED`/`DUPLICATE`
examples show no obvious creation-time lexical tell. This supports the
decision-rule sentence in §10.

## 7. Duplicate / related-case cross-split protection

**Method used (manual, targeted — not yet an automated full-corpus sweep):**
for all 20 issues in the full 1056-issue population with `stateReason ==
DUPLICATE`, fetched title, body, and up to 10 comments, and regex-scanned
for `#<number>` cross-references to other issues. Verified each referenced
issue's own `createdAt`, `authorAssociation`, and `stateReason`.

**Result: one confirmed cross-split connected group**, all describing the
same underlying "platform storage / keyring `PermissionDenied`" defect
across container/Windows environments:

- `#1845` (2026-07-28, `DUPLICATE`, external) — DEV
- `#1848` (2026-07-28, `COMPLETED`, external) — DEV
- `#1852` (2026-07-28, `COMPLETED`, external) — DEV
- `#1918` (2026-08-04, `DUPLICATE`, external) — FINAL_HOLDOUT
- `#1931` (2026-08-05, `DUPLICATE`, external) — FINAL_HOLDOUT
- `#1938` (2026-08-06, `DUPLICATE`, external) — FINAL_HOLDOUT
- (Also cross-referenced: `#1872`, `#1891`, `#1947`, `#1950` — all
  `MEMBER`-authored and therefore already outside the eligible population
  per §2.2.1; no additional action needed for these.)

**Resolution applied:** this entire group is **excluded from evaluation**
(both the DEV-side and FINAL_HOLDOUT-side members) rather than retained in
either split, per the rule "a related group must either live entirely
inside one partition, or be excluded from evaluation" — it cannot be moved
into one partition because its members are chronologically pinned across
the DEV/HOLDOUT boundary. This exclusion is already reflected in the final
counts in §4.2 (6 instances removed: 2 ACCEPTED + 1 NOT_ACCEPTED from DEV,
3 NOT_ACCEPTED from FINAL_HOLDOUT).

**Other reference chains checked and found NOT cross-split** (both ends
land in TRAIN, so no action needed): `#172`↔`#173`, `#310`↔`#302`,
`#656`↔`#649`, `#689`↔`#673`. One chain (`#2122`↔`#2056`) has both ends in
FINAL_HOLDOUT — same partition, no action needed. One chain (`#2241` and
its references) is entirely `MEMBER`-authored — already outside the
eligible population.

**Open item for GATE 02:** this was a targeted, manual sweep of the 20
`DUPLICATE`-stateReason issues only (i.e. issues where we already know one
side of the pair). It did **not** systematically search `COMPLETED` /
`NOT_PLANNED` issue bodies for references to each other, which could in
principle surface additional related-but-not-formally-duplicate pairs
(e.g. "see also #X" without a `duplicate` state). GATE 02 (dataset
materialization) must run a full-corpus reference-graph sweep over all
eligible issues' bodies + comments before freezing `data/*.jsonl`, using
the same method demonstrated here (regex `#\d+` extraction + connected
components + same-partition-or-exclude rule).

## 8. Root cause of the 54% → 40% → 97% label-completeness drift (from GATE 01)

Investigated directly rather than left as a caveat:

**Finding: it is a real, dateable process change — a v1→v2 migration purge
event — not ordinary triage lag and not a change in issue-template
software.**

- 56 of the original DEV window's 61 `NOT_PLANNED`-labeled issues (under
  the six-label GATE 01 taxonomy) were closed on a **single calendar day,
  2026-08-01**, and 53 of those 56 carry the `closed-v1-deprecated` label
  (one carries `closed-v1-security-declined`).
- This is a bulk administrative closure: the maintainers evidently swept
  the backlog of legacy `v1`-track issues around the `v1`→`v2` cutover and
  closed them en masse as "not planned" (because v1 was being deprecated
  wholesale, not because each issue was individually judged on its
  merits).
- This single event explains most of the apparent DEV-window anomaly in
  both the original bug/enhancement taxonomy (GATE 01) and would have
  similarly distorted a naive resolution-policy target had it not been
  filtered out here (§2.2.2).
- It does **not** fully explain the FINAL_HOLDOUT-side 97% figure from
  GATE 01, which is a separate, likely benign effect: FINAL_HOLDOUT is the
  most recent slice, and recently-triaged issues in an actively maintained
  repo tend to get *some* label quickly (even if only a coarse one) before
  the deeper bug/enhancement/chore-style classification lags behind —
  consistent with ordinary triage lag layered on top of the one-time purge
  event, rather than a second distinct process change.
- **Consequence for this gate's target:** because Candidate A's eligibility
  filter (§2.2.2) explicitly excludes `closed-v1-deprecated` /
  `closed-v1-security-declined` issues, the resolution-policy target is
  immune to this specific purge event by construction. The class-ratio
  stability shown in §4.2 (84%/78%/86% ACCEPTED across TRAIN/DEV/HOLDOUT)
  is direct evidence the purge was the dominant driver of the original
  drift, not a symptom of some other, unaddressed regime change.
- **Residual open risk:** we have not ruled out smaller, less visible
  process changes (e.g. gradual shifts in how strictly "not planned" is
  applied). This is flagged as an ongoing monitoring item rather than a
  blocking issue, given the stability evidence above.

## 9. Metric contract (proposed, not yet implemented)

- Primary metric: macro-F1 over `{ACCEPTED, NOT_ACCEPTED}` on
  FINAL_HOLDOUT (51 eligible instances: 44 ACCEPTED / 7 NOT_ACCEPTED, per
  §4.2).
- Secondary/diagnostic metric: recall on the `DUPLICATE` sub-case within
  `NOT_ACCEPTED` (very small n — 1 instance in FINAL_HOLDOUT after §7
  exclusion — reported for qualitative insight only, not as a pass/fail
  gate).
- DEV (65 eligible: 51/14) is for iteration/threshold tuning only.
  FINAL_HOLDOUT is touched exactly once, after DEV-based decisions are
  frozen, per IMPLEMENTATION_PLAN.md's ordering constraint.
- Baseline to beat: majority-class predictor (always predict `ACCEPTED`)
  on FINAL_HOLDOUT — accuracy 44/51 = 86.3%, but 0% recall on
  `NOT_ACCEPTED`, macro-F1 = (F1_ACCEPTED + 0)/2. F1_ACCEPTED with
  precision 44/51=0.863, recall 1.0 → F1≈0.926. Macro-F1 ≈ **0.46**. Any
  real agent must exceed this macro-F1, not just accuracy — with only 7
  positive `NOT_ACCEPTED` cases in FINAL_HOLDOUT, a handful of correct
  predictions materially moves this number, which must be reported with
  its raw confusion counts, not just the macro-F1 scalar.

## 10. Decision-rule defense

"A generic model can understand the issue, but it needs this repository's
historical decisions to learn how THIS TEAM handles cases like it."

This holds for the selected target: §6's cold-baseline audit found no
lexical self-disclosure in `NOT_ACCEPTED` (either `NOT_PLANNED` or
`DUPLICATE`) issue text among the sampled external-authored cases, and §3
shows the two rejected alternatives (version routing, subsystem routing)
fail this sentence precisely because their answers ARE explicit in the
reporter's own template text. `modelcontextprotocol/inspector` is retained
as the benchmark repository — no repository change is required.

## 11. Reproducibility

Query used to pull `stateReason`, `authorAssociation`, and labels
(read-only, paginated):

```
gh api graphql --paginate -f query='
query($endCursor: String) {
  repository(owner: "modelcontextprotocol", name: "inspector") {
    issues(first: 100, after: $endCursor, orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        state
        stateReason
        createdAt
        closedAt
        authorAssociation
        author { login }
        labels(first: 10) { nodes { name } }
      }
    }
  }
}' --jq '.data.repository.issues.nodes[]'
```

Duplicate cross-reference sweep (§7) used per-issue queries fetching
`title`, `body`, and `comments(first: 10) { nodes { body } }` for the 20
`DUPLICATE`-stateReason issues, then a `#\d+` regex extraction.

No raw data file or dataset file is committed in this gate. Materializing
`data/train.jsonl` / `data/dev.jsonl` / `data/final_holdout.jsonl` (issue
number, `ACCEPTED`/`NOT_ACCEPTED` label, and — pending a redaction pass —
title/body text) is deferred to GATE 02, after this contract is reviewed.

## 12. Next gate

`EVAL_CONTRACT_REVIEW_02_REQUIRED`
