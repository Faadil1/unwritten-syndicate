# PROJECT_SPEC — GATE 01 / GATE 01B

Status: draft, produced under GATE 01 (SPEC + EVAL CONTRACT) and revised
under GATE 01B (BENCHMARK HARDNESS + POLICY TARGET REDESIGN). No agent code
has been implemented.

**GATE 01B revision note:** the GATE 01 taxonomy (§3 below, "REJECTED" as
of this revision) was rejected at eval-contract review for measuring
generic semantic issue classification rather than repository-specific
operating judgment. §3 is kept, marked rejected, and explained rather than
deleted. §3B defines the taxonomy actually in force. See
`docs/EVAL_CONTRACT.md` for the full hardness analysis behind this change.

## 1. Problem

Build an agent that triages incoming GitHub issues by predicting a category label
(e.g. `bug` vs `enhancement`) from issue content, evaluated against real historical
issue data rather than synthetic examples.

## 2. Target repository under study

- Repo: `modelcontextprotocol/inspector` (public, read-only access via `gh`)
- Snapshot pulled: 2026-09-06 (UTC timestamps from GitHub GraphQL API)
- Total issues at snapshot time: 1056 (`OPEN`: 36, `CLOSED`: 1020)
- Total PRs at snapshot time: 1185 (not used in this gate; issues only)
- Distinct labels in repo: 31

This repository was chosen because it is public, has a long enough history
(first issue: 2024-10-08) and enough volume (1056 issues) to support a
chronological train/dev/holdout split, and `gh` can read it without
write/authoring access.

## 3. Candidate taxonomy (GATE 01 — REJECTED at review, kept for record)

Raw label distribution across all 1056 issues (top entries):

| label | count |
|---|---|
| v2 | 504 |
| bug | 351 |
| enhancement | 176 |
| v1 | 144 |
| closed-v1-deprecated | 139 |
| auth | 110 |
| chore | 63 |
| waiting on submitter | 48 |
| spec compliance | 28 |
| tools | 21 |
| documentation | 19 |
| question | 16 |
| ... | (19 more, each ≤13) |

`v1`/`v2` are version-migration markers, not issue-type signals, and are
excluded from the taxonomy (see COMPLIANCE.md / leakage discussion in
EVAL_CONTRACT.md).

**Selected taxonomy for GATE 01: 2-class, single-label**

- `bug`
- `enhancement`

Rationale: these are the only two categories with (a) large enough absolute
volume, and (b) a *stable* presence across the full chronological range
(train/dev/holdout, see EVAL_CONTRACT.md §3). Other categories
(`question`, `documentation`, `chore`, `refactor`) are either too sparse
(≤19 each) or exhibit severe temporal drift (see leakage risks) and are
excluded from the modeled taxonomy for this gate. Issues carrying only
those labels, no label, or multiple conflicting taxonomy labels are
excluded from the usable sample (see EVAL_CONTRACT.md).

**Rejection reason (GATE 01B):** this measures generic semantic issue
classification, not repository-specific operating judgment. GitHub issue
templates make `bug` vs `enhancement` largely explicit at creation time
(structured "Describe the bug" sections vs. "Feature Request:" language), so
a strong cold LLM could plausibly solve most of it without learning
anything about how this team actually operates. See
`docs/EVAL_CONTRACT.md` §0 and §3 (Candidate B/C hardness tests) for full
detail.

## 3B. Selected taxonomy (GATE 01B, in force)

**Target: resolution policy for externally-reported issues.**

- **`ACCEPTED`** — issue closed with GitHub `stateReason == COMPLETED`
- **`NOT_ACCEPTED`** — issue closed with `stateReason ∈ {NOT_PLANNED, DUPLICATE}`

Scoped to issues opened by external contributors
(`authorAssociation ∈ {NONE, FIRST_TIME_CONTRIBUTOR, CONTRIBUTOR}`),
excluding issues closed via the v1→v2 administrative migration purge
(`closed-v1-deprecated` / `closed-v1-security-declined` labels), and
excluding still-open/unresolved issues (right-censored, not a confirmed
`ACCEPTED`).

Rationale: this reflects an actual team decision (does this get
independent action, or not) that requires institutional knowledge —
duplicate detection requires knowing prior issue history; "not planned"
requires knowing this team's actual scope/priority boundaries, not just
reading the request. Full hardness test, cold-baseline audit, and
duplicate cross-split protection are in `docs/EVAL_CONTRACT.md`.

## 4. Non-goals for GATE 01 / GATE 01B

The following are explicitly NOT built in this gate:

- PolicyAgent
- Reflector
- Rulebook / memory engine
- Learning rounds
- Demo UI

This gate produces only: feasibility analysis, taxonomy selection, eval
contract, compliance notes, build ledger, and an implementation plan for
future gates.

## 5. Data source and access method

- Source: GitHub GraphQL API via `gh api graphql`, read-only, paginated by
  `createdAt` ascending.
- Fields captured (GATE 01): `number`, `state`, `createdAt`, `closedAt`,
  `labels`.
- Fields captured (GATE 01B, additive): `stateReason`, `authorAssociation`,
  `author.login`; plus targeted `title`/`body`/`comments` fetches for (a) a
  fixed 25-issue DEV lexical-leakage audit sample and (b) the 20
  `DUPLICATE`-stateReason issues for cross-split duplicate-group detection.
  See EVAL_CONTRACT.md §6–7.
- No issue body/title text was downloaded for the bulk 1056-issue
  population in either gate (only for the two targeted samples above).
  Full body/title retrieval for feature extraction is deferred to GATE 02
  and is subject to the compliance notes in COMPLIANCE.md.

## 6. Next gate

`EVAL_CONTRACT_REVIEW_02_REQUIRED` — human review of the revised eval
contract before any dataset materialization or agent implementation
begins.
