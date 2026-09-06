# COMPLIANCE — GATE 01

## 1. Data source terms

- Data source: public GitHub repository `modelcontextprotocol/inspector`,
  accessed via GitHub's public GraphQL API through the authenticated `gh`
  CLI (account: `Faadil1`, scopes: `gist`, `read:org`, `repo`, `workflow`).
- Access was read-only: no issues, comments, or labels were created,
  modified, or deleted on the target repository during this gate.
- Only metadata (issue number, state, timestamps, labels) was retrieved in
  this gate. No issue body/title text, no comments, and no author/user PII
  was retrieved.
- GitHub's public API terms permit reading public issue metadata for
  analysis of this kind; this project does not redistribute the raw GitHub
  data, only aggregate counts/statistics derived from it (see
  EVAL_CONTRACT.md).

## 2. PII / sensitive data

- No usernames, emails, or free-text issue content have been captured or
  stored in this repository as of GATE 01.
- If a future gate retrieves issue body/title text for feature extraction,
  that text may contain: reporter-identifying information, environment
  details (paths, hostnames), or pasted secrets/tokens accidentally
  included by third-party reporters. Any such retrieval must be treated as
  a new compliance decision point, not an automatic extension of this
  gate's approval, and should include a scrub/redaction step before any
  content is committed to this repository.

## 3. Credentials

- `gh` authentication used in this session is the operator's existing
  GitHub CLI login; the token was not printed, copied, or embedded in any
  committed file. No new credentials were created for this gate.

## 4. Scope discipline

- This gate implements no executable agent logic (see explicit non-goals in
  PROJECT_SPEC.md §4). All deliverables are documentation.
- No dataset files (`data/*.jsonl` or similar) were committed in this gate.
  Only aggregate statistics appear in EVAL_CONTRACT.md.
- No push to the remote GitHub repository (`Faadil1/unwritten-syndicate`)
  was performed as part of this gate; changes were committed locally only.
  Publishing (push) requires separate explicit authorization per this
  project's orchestration rules.

## 5. Open compliance items for future gates

1. Decide a redaction/scrub policy before pulling issue body/title text.
2. Decide whether near-duplicate detection (EVAL_CONTRACT.md §5 item 6)
   requires pulling additional content, and if so, re-run this compliance
   check.
3. Confirm whether the final agent's predictions or any published results
   will be shared publicly (e.g., posted back to the source repository) —
   out of scope for this gate, and not authorized here.
