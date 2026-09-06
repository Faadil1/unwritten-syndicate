# EVAL_CONTRACT — GATE 01C (FINAL BENCHMARK FREEZE)

Status: **FROZEN as of GATE 01C** (see §13 for the freeze record). The
target design (§1–§11, GATE 01B) was accepted at
`EVAL_CONTRACT_REVIEW_02`. GATE 01C (§12–§14) applies precise class naming,
a maturity/censoring control, a moved temporal boundary to fix a thin
minority class, a full-corpus duplicate sweep, and a cold-baseline audit,
then freezes the split manifests. Next gate:
`FINAL_BENCHMARK_FREEZE_REVIEW_REQUIRED`. **After this freeze, FINAL_HOLDOUT
membership must not be modified based on any model result.**

**Revision history:**
- GATE 01: proposed `{bug, enhancement}` label-classification target. REJECTED
  at review — see §0 below for why, kept for the record.
- GATE 01B: proposed a resolution-policy target (`ACCEPTED`/`NOT_ACCEPTED`)
  instead, after hardness testing three candidates and auditing for
  lexical/temporal leakage and cross-split duplication. ACCEPTED IN
  PRINCIPLE at `EVAL_CONTRACT_REVIEW_02`.
- GATE 01C (this revision): renames the classes to avoid overclaiming
  intent, adds a maturity/censoring control, moves the temporal boundary to
  fix a too-thin FINAL_HOLDOUT minority class, completes a full-corpus
  duplicate/related-case sweep, runs an actual cold baseline on DEV, freezes
  the exact predictor input contract, and freezes split manifests with
  hashes. §1–§11 below are preserved verbatim from GATE 01B (some counts in
  §4 are superseded by the final frozen counts in §12.3 — GATE 01B's numbers
  are kept for traceability of how the design evolved, not as the operative
  counts).

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

## 12. GATE 01C — precise target language, maturity control, boundary fix

### 12.1 Precise target language (renamed classes)

Same GitHub ground truth as GATE 01B, renamed to avoid overclaiming intent:

- **`RESOLVED_COMPLETED`** = `stateReason == COMPLETED` (was `ACCEPTED`)
- **`RESOLVED_NO_NEW_WORK`** = `stateReason ∈ {NOT_PLANNED, DUPLICATE}` (was `NOT_ACCEPTED`)

**This benchmark predicts historical GitHub resolution disposition — the
maintainers' recorded close reason — not guaranteed future engineering
effort, not code quality, and not issue validity.** Human-facing product
copy may describe this as "actioned" vs. "declined/duplicate," but this
document and any metrics reporting must use `RESOLVED_COMPLETED` /
`RESOLVED_NO_NEW_WORK` and must not imply the model predicts what *should*
happen, only what historically *did* get recorded as the resolution.
Eligibility scope is unchanged: externally-reported issues only (§2.2.1),
excluding v1-migration purge closures (§2.2.2).

### 12.2 Maturity / censoring control

**Problem:** issues created very close to the snapshot cutoff have had less
wall-clock time to resolve. Since unresolved (open) issues are excluded
from the eligible population (§2.2.3, §5), the *resolved* population near
the snapshot is biased toward whatever resolves fast — which may not be
uniform across classes (e.g. a `DUPLICATE` closure can happen in minutes;
a genuine engineering fix can take months). This is a distinct risk from
the administrative-purge drift already handled in §8.

**Method (computed from TRAIN+DEV only, per instruction, before touching
FINAL_HOLDOUT):** using the 389 eligible resolved issues from GATE 01B's
TRAIN+DEV population (created before the GATE 01B T2 boundary,
2026-07-29T18:00:00Z), computed the distribution of time-to-resolution
(`closedAt − createdAt`, in hours):

| percentile | time-to-resolution |
|---|---|
| p50 | 311.0 hours (13.0 days) |
| p75 | 1490.3 hours (62.1 days) |
| p90 | 3665.3 hours (152.7 days) |
| p95 | 4412.5 hours (183.9 days) |
| max | 9308.8 hours (387.9 days) |

This is a long-tailed distribution typical of issue trackers: most
resolutions happen quickly, but a real tail resolves only after several
months (often via later, unrelated cleanup).

**Maturity lag chosen: L = 60 days.** Rationale: 60 days sits just below
the empirical p75 (62.1 days) computed above — i.e., roughly three
quarters of ever-resolved issues in this population resolve within this
window. This is a deliberate compromise, stated plainly rather than hidden:
- A larger L (e.g. p90 ≈ 153 days, p95 ≈ 184 days) would be more
  conservative against censoring bias but would make FINAL_HOLDOUT
  infeasible — it would consume nearly the entire remaining post-T2 date
  range available in this repository snapshot, leaving too little room to
  also satisfy the §12.3 minority-count requirement without pushing T2 far
  enough back to threaten TRAIN/DEV size.
- A smaller L (e.g. p50 ≈ 13 days) would admit more recent issues into
  FINAL_HOLDOUT but leave a materially larger fraction of the "true"
  eventual resolutions still in-flight and therefore still wrongly
  excluded as open at snapshot time, reintroducing the resolution-speed
  bias this control exists to reduce.
- **L was chosen only from this TRAIN+DEV time-to-resolution distribution.
  No model was run and no FINAL_HOLDOUT metric was computed before this
  choice was made.**

**Applied rule:** an issue is eligible for FINAL_HOLDOUT only if
`created_at ≤ SNAPSHOT_CUTOFF − L`, i.e.
`created_at ≤ 2026-09-06T00:08:45Z − 60 days = 2026-07-08T00:08:45Z`
("the maturity cutoff"). Issues created after the maturity cutoff (69 of
the 443 total eligible-resolved issues) are **dropped from the dataset
entirely** — not placed in any split — because they are simultaneously too
recent to be safely evaluated in FINAL_HOLDOUT and too recent to precede
FINAL_HOLDOUT chronologically, so no split can legitimately contain them
without violating strict chronology or the maturity rule. This is a
disclosed, permanent reduction in usable data, not a failure: the
benchmark remains feasible, per §12.3.

### 12.3 Final minority floor — moved T2 boundary

GATE 01B's FINAL_HOLDOUT (T2 = 2026-07-29T18:00:00Z) had only 7
`RESOLVED_NO_NEW_WORK` cases — too unstable for a macro-F1 claim, and in
any case now superseded by the maturity cutoff, which caps FINAL_HOLDOUT's
latest admissible issue at 2026-07-08T00:08:45Z (earlier than GATE 01B's
old T2). T2 was moved earlier (chronology preserved: TRAIN → DEV →
FINAL_HOLDOUT, strictly increasing) to satisfy, simultaneously:

- FINAL_HOLDOUT total ≥ 50
- FINAL_HOLDOUT `RESOLVED_NO_NEW_WORK` ≥ 15
- a "useful" DEV set (not degenerately small)
- the §12.4 duplicate-family exclusion rule (a family may not straddle a
  partition boundary)

**Procedure (boundary chosen only from these count/maturity/family
constraints, never from any model's performance):** walked the maturity-
capped eligible population backward from the maturity cutoff, growing the
candidate FINAL_HOLDOUT window until both count floors were met *after*
applying the §12.4 family-exclusion rule (exclusions reduce the raw count,
so the window had to be grown past the point where raw counts alone looked
sufficient — the first window that hit 50/15 pre-exclusion (86 issues, 15
minority) dropped to only 14 minority post-exclusion, so the window was
grown further). The smallest window satisfying both floors *after*
exclusion is 92 issues pre-exclusion / 88 post-exclusion, with 15
`RESOLVED_NO_NEW_WORK` cases surviving.

T1 (TRAIN/DEV boundary) was set at the 75th percentile of the remaining
pre-T2 pool, preserving a DEV set of useful size (66 issues) while
maximizing TRAIN size.

**Outcome:** FINAL_HOLDOUT: 88 total, 15 `RESOLVED_NO_NEW_WORK` — the
minority floor is met exactly, not exceeded by a comfortable margin. This
is disclosed rather than smoothed over: any single additional
misclassification of a minority case moves recall on that class by
1/15 ≈ 6.7 percentage points. Metric reporting must always show raw
confusion counts alongside macro-F1, per §9's existing requirement (now
also see §12.7).

No infeasibility was hit — 15 minority cases were achievable without
resorting to a boundary that would have created new policy-regime
contamination (verified by checking the resulting window does not
reintroduce the §8 purge event or a comparable one — the window
2025-09-13 → 2026-06-28 does not include the 2026-08-01 purge date at all,
since that now falls in the dropped too-immature zone).

### 12.4 Full-corpus duplicate/related-case sweep

**GATE 01B's sweep was partial** (only the 20 `DUPLICATE`-stateReason
issues were checked for cross-references). GATE 01C completes a
full-corpus sweep before freezing.

**Method:** fetched `title`, `body`, and up to 15 comments for all 443
eligible-resolved issues (external authorship, non-purge, resolved) via
batched GraphQL queries. Regex-extracted `#<number>` cross-references
between eligible issues, built an undirected reference graph, and computed
connected components (union-find) — this detects explicit duplicate links,
"see also" references, and superseding-issue mentions in one pass; issues
with `stateReason == DUPLICATE` are automatically included since they
carry at least one such reference by construction of how the sweep works
(any issue referencing another eligible issue forms an edge, regardless of
whether that issue's own stateReason is `DUPLICATE`).

**Result:** 85 cross-reference edges among the 443 eligible issues, forming
28 connected groups of size ≥ 2 (395 issues remain singletons). Every
group was checked against the final partition boundaries (§12.3). **7
groups crossed a partition boundary** (TRAIN/DEV, DEV/HOLDOUT, or
TRAIN/HOLDOUT):

| group | members (number\:partition) |
|---|---|
| 1 | `#415`:TRAIN, `#622`:DEV |
| 2 | `#495`:TRAIN, `#620`:DEV |
| 3 | `#516`:TRAIN, `#1280`:HOLDOUT |
| 4 | `#520`:TRAIN, `#700`:DEV |
| 5 | `#724`:DEV, `#831`:HOLDOUT |
| 6 | `#552`:TRAIN, `#1005`:HOLDOUT |
| 7 | `#601`:TRAIN, `#1509`:HOLDOUT (`#1849`,`#1858`,`#1937` in the same family are already dropped as too-immature under §12.2 — no action needed for those three) |

**Resolution:** all 14 issue instances in these 7 groups that fall inside a
real partition (TRAIN, DEV, or HOLDOUT) are **excluded from evaluation
entirely** — `#415, #495, #516, #520, #552, #601, #620, #622, #700, #724,
#831, #1005, #1280, #1509`. None of these families could be legitimately
reassigned into a single partition (their members are chronologically
pinned on opposite sides of a boundary that is itself constrained by
§12.2/§12.3), so exclusion is the only rule-compliant option. This
exclusion is recorded in `data/gate01c_manifests/manifest_excluded_duplicate_families.json`
and is already reflected in the final frozen counts (§12.6, §12.8).

The 21 remaining connected groups (including the GATE 01B-identified
"platform storage / keyring PermissionDenied" cluster, now fully inside
FINAL_HOLDOUT or fully inside a dropped/too-immature zone under the new
boundaries) do not cross a real-partition boundary and require no
exclusion; they remain in the dataset as ordinary (non-excluded) issues.

**Residual limitation, disclosed:** this sweep detects explicit `#number`
textual cross-references only. It cannot detect duplicate/related issues
that never explicitly cite each other's number (e.g. two independent
reports of the same bug with no comment linking them). This is a known,
bounded gap — full semantic near-duplicate detection (e.g. embedding
similarity) is out of scope for GATE 01C and is not required by the
review instructions, which specify explicit links, `DUPLICATE`
stateReason, and textual "duplicate/superseded" references — all of which
this method covers.

### 12.5 Cold baseline — DEV only, actual run

**Model/configuration:** the orchestrator LLM itself (Claude Sonnet 5, as
running in this session) was used as the "intended underlying model,"
since no separate model API is available/authorized in this harness for a
standalone baseline call. A single fixed classification protocol was
applied once, by hand, to each DEV issue:

> *Protocol:* read only the issue's `title` and the first ~600 characters
> of its `body` (no comments, no labels, no `stateReason`, no other
> metadata, no repository history, no search). Predict
> `RESOLVED_COMPLETED` unless the report reads as spam/placeholder
> boilerplate text, a vague unreproducible environment/config complaint
> that looks like user error rather than a project defect, a pure
> discussion/design musing without a concrete scoped ask, or a support
> question rather than a report — those cases predict
> `RESOLVED_NO_NEW_WORK`. Applied uniformly, one pass, no retries, no
> access to ground truth until after all 66 predictions were recorded.

**Exact DEV IDs used (all 66 eligible DEV issues, i.e. the full frozen DEV
manifest — not a sub-sample):**

`594, 600, 606, 608, 610, 617, 623, 627, 630, 633, 634, 635, 636, 649, 656,
657, 658, 666, 670, 672, 674, 678, 679, 682, 683, 685, 686, 688, 689, 693,
695, 696, 699, 704, 712, 720, 721, 723, 725, 726, 732, 737, 738, 743, 744,
748, 750, 752, 753, 755, 756, 758, 759, 763, 764, 766, 771, 773, 779, 780,
783, 784, 788, 790, 794, 796`

Full predictions, per-issue truth, and confusion counts are committed at
`data/gate01c_manifests/dev_cold_baseline_results.json`.

**Results:**

- **Macro-F1: 0.6042**
- Accuracy: 0.7424 (49/66 correct)
- `RESOLVED_COMPLETED`: precision 0.898, recall 0.786, F1 0.838 (support 56)
- `RESOLVED_NO_NEW_WORK`: precision 0.294, recall 0.500, F1 0.370 (support 10)
- Confusion matrix:

| truth \ predicted | `RESOLVED_COMPLETED` | `RESOLVED_NO_NEW_WORK` |
|---|---|---|
| `RESOLVED_COMPLETED` (56) | 44 | 12 |
| `RESOLVED_NO_NEW_WORK` (10) | 5 | 5 |

**Interpretation: 0.60 macro-F1 is well below the 0.90 hardness-warning
threshold — no hardness warning triggered.** The failure pattern is
qualitatively informative, not just quantitatively low:
- 5 of 10 `RESOLVED_NO_NEW_WORK` cases were misread as `RESOLVED_COMPLETED`
  *despite* being well-formed, detailed, reproducible bug/feature reports
  (e.g. `#608` OAuth refresh-token bug, `#657` CLI array-type bug, `#689`
  optional-`None`-parameter bug, `#737` detailed OAuth/AAD question,
  `#744` detailed Okta metadata-URL bug) — good report quality did not
  predict acceptance.
- Conversely, 12 of 56 `RESOLVED_COMPLETED` cases were misread as
  `RESOLVED_NO_NEW_WORK` because they *looked* low-effort, vague, or
  user-error-shaped by generic reading standards (e.g. `#688` one-word
  "apiserver" title, `#764` a bare help request, `#704`/`#693` newbie
  environment questions, `#794` a terse stack-trace-only report, `#720` a
  discussion-style post) — the maintainers evidently still invested effort
  in several of these despite surface unpromising presentation.
- **This is direct evidence for the decision-rule sentence (§10):** generic
  textual-quality heuristics systematically mispredict this team's actual
  behavior in both directions, which is exactly the gap a
  history-informed agent is meant to close. No repeated prompt tuning was
  performed against this DEV result — it is reported as obtained, on the
  first and only pass.

### 12.6 Predictor input contract (frozen)

**Permitted inputs at prediction time (creation-time only):**
- `title`
- `body`
- creation-time-stable metadata explicitly justified: `createdAt`
  (needed to enforce chronology/lookup-cutoff for any future
  historical-search tool), `authorAssociation` (already used to *define*
  the eligible population — not a leak, since it is fixed at issue
  creation and does not depend on outcome)

**Explicitly excluded from predictor input** (fields whose historical
timing at the moment of an equivalent real-time decision cannot be proven,
or that directly encode the outcome):
- final `labels` (assigned over the issue's lifetime, some post-resolution)
- final `milestone`
- final `assignee`
- `stateReason` / `closedAt` (this is the prediction target itself)
- closing comments and any comments (comments accrue after creation and
  can contain maintainer decisions or reporter follow-ups that leak the
  outcome)
- linked fixing PRs
- later commits

**Historical-search tool constraint (for future gates, not built yet):**
any tool that lets a future agent search prior issues for context may only
return records with `createdAt` strictly earlier than the issue currently
being classified. This is a forward-looking freeze rule, recorded here so
GATE 02+ implementation cannot silently violate it.

### 12.7 Reason-subtype diagnostic (evaluator-only, not a prediction target)

Binary scoring remains `RESOLVED_COMPLETED` vs `RESOLVED_NO_NEW_WORK`
(§12.1). The underlying GitHub `stateReason` subtype
(`COMPLETED`/`NOT_PLANNED`/`DUPLICATE`) is retained in every manifest
(`subtype` field) purely as an **evaluator-only diagnostic** — future
gates may report, e.g., "recall on the `DUPLICATE` subtype within
`RESOLVED_NO_NEW_WORK`" to show separately whether a learning system
improved duplicate-recognition versus scope/priority-rejection judgment.
This subtype is never an input to any predictor and is never itself scored
as a separate classification target.

### 12.8 Final frozen counts (after §12.2 maturity filter, §12.3 boundary
move, and §12.4 duplicate-family exclusion — these supersede all earlier
count tables in this document)

| split | UTC start (inclusive) | UTC end | total | `RESOLVED_COMPLETED` | `RESOLVED_NO_NEW_WORK` |
|---|---|---|---|---|---|
| TRAIN | 2024-11-25T23:40:07Z | < 2025-07-09T16:01:24Z | 206 | 176 | 30 |
| DEV | 2025-07-09T16:01:24Z | < 2025-09-13T06:19:40Z | 66 | 56 | 10 |
| FINAL_HOLDOUT | 2025-09-13T06:19:40Z | ≤ 2026-07-08T00:08:45Z (maturity cutoff) | 88 | 73 | 15 |

Dropped entirely (too immature under §12.2, not in any split): 69 issues,
`created_at > 2026-07-08T00:08:45Z` and `≤ 2026-09-06T00:08:45Z`
(SNAPSHOT_CUTOFF).

Excluded entirely (cross-split duplicate family, §12.4): 14 issues,
listed in `data/gate01c_manifests/manifest_excluded_duplicate_families.json`.

Class balance: TRAIN 85.4%/14.6%, DEV 84.8%/15.2%, FINAL_HOLDOUT
83.0%/17.0% `RESOLVED_COMPLETED`/`RESOLVED_NO_NEW_WORK` — directionally
stable across all three splits (tighter than the GATE 01B numbers were),
which is additional evidence the target is not drifting under a
regime-change artifact.

## 13. Freeze record

- **Snapshot cutoff:** `2026-09-06T00:08:45Z` (the `createdAt` of the last
  issue pulled in the full-corpus fetch).
- **Maturity lag:** L = 60 days (§12.2); maturity cutoff =
  `2026-07-08T00:08:45Z`.
- **Taxonomy:** `{RESOLVED_COMPLETED, RESOLVED_NO_NEW_WORK}`, binary,
  evaluator-only subtype `{COMPLETED, NOT_PLANNED, DUPLICATE}` (§12.1,
  §12.7).
- **Split boundaries (UTC, exact, non-overlapping, strict chronology):**
  - TRAIN: `created_at < 2025-07-09T16:01:24Z`
  - DEV: `2025-07-09T16:01:24Z ≤ created_at < 2025-09-13T06:19:40Z`
  - FINAL_HOLDOUT: `2025-09-13T06:19:40Z ≤ created_at ≤ 2026-07-08T00:08:45Z`
  - (Issues with `created_at > 2026-07-08T00:08:45Z` are dropped, not
    assigned to any split, per §12.2.)
- **Exclusion groups:** 14 issues excluded for cross-split duplicate-family
  contamination (§12.4); manifest at
  `data/gate01c_manifests/manifest_excluded_duplicate_families.json`.
- **Allowed predictor inputs:** frozen in §12.6.
- **Cold DEV baseline:** recorded in §12.5 and
  `data/gate01c_manifests/dev_cold_baseline_results.json`.
- **Manifests and hashes:** see §14.

**After this freeze, FINAL_HOLDOUT composition (`data/gate01c_manifests/manifest_final_holdout.json`)
must not be modified based on any model's performance.** Any future change
to FINAL_HOLDOUT membership requires a new, explicitly numbered gate
(e.g. GATE 01D) with the same rigor applied here, not a silent edit.

## 14. Manifests

Committed at `data/gate01c_manifests/` (issue number, binary label,
evaluator-only subtype, and `createdAt` only — no title/body/comment text,
per the compliance scope in `docs/COMPLIANCE.md`):

| file | records | SHA-256 |
|---|---|---|
| `manifest_train.json` | 206 | `c243be0d21cf375b63d6474c99fb38d75613597d581ca30475882ab4c36d089a` |
| `manifest_dev.json` | 66 | `ac4e4e075f32d62689ac1bd9acf540a051588515798bf3c5c2684491a1eb7579` |
| `manifest_final_holdout.json` | 88 | `09a9a3077c27cb454b8733eccf248e2d9771fbdf82e40da84bd74cc38dd296f6` |
| `manifest_excluded_duplicate_families.json` | 14 | `2bd6ab925e731250713a1223e20be1e784e3a73662b776c273553cd61d92f09e` |

Hashes also recorded standalone at `data/gate01c_manifests/manifest_hashes.txt`.
`dev_cold_baseline_results.json` (not hash-frozen — it is a diagnostic
artifact, not part of the split definition) holds the full §12.5 results.

## 15. Next gate

`FINAL_BENCHMARK_FREEZE_REVIEW_REQUIRED`
