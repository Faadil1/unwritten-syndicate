# PROJECT_SPEC — GATE 01

Status: draft, produced under GATE 01 (SPEC + EVAL CONTRACT). No agent code has been implemented.

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

## 3. Candidate taxonomy (selected after inspecting real label distribution)

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

## 4. Non-goals for GATE 01

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
- Fields captured: `number`, `state`, `createdAt`, `closedAt`, `labels`.
- No issue body/title text was downloaded in this gate (label distribution
  analysis only). Body/title retrieval for feature extraction is deferred to
  the implementation gate and is subject to the compliance notes in
  COMPLIANCE.md.

## 6. Next gate

`EVAL_CONTRACT_REVIEW_REQUIRED` — human review of the eval contract before
any dataset materialization or agent implementation begins.
