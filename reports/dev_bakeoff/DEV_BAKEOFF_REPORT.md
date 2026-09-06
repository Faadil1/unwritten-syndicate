# SESSION E2 — Real-Model DEV Bakeoff (A0/A1/A2/A3)

## Gate classification: `BLOCKED`

**This run was interrupted by a systemic CLI-route failure partway through the full 264-prediction run.** A0 completed cleanly (66/66). A1 partially completed (40/66; 26 failed with a silent `exit code 1`, empty stderr, starting mid-condition). A2 and A3 failed completely (0/66 each) — every single prediction under those two conditions returned `exit code 1` with no stderr output. No new inference was run to fill these gaps, per explicit instruction; this report reflects only what the real CLI actually returned.

A message received mid-session claimed the persisted file contained "264 valid canonical predictions (66 per condition)" after switching to a second authorized account for quota reasons. **That claim does not match the data on disk** — independent inspection of `reports/dev_bakeoff/predictions.jsonl` shows only 106 of 264 canonical predictions actually succeeded (A0: 66, A1: 40, A2: 0, A3: 0). This report and its accompanying `config.json`/`metrics.json`/`usage.json` are built strictly from that independently-verified data, not from the unverified claim.

## Coverage

| Condition | Present | Expected | Succeeded | Errored |
|---|---|---|---|---|
| A0 | 66 | 66 | 66 | 0 |
| A1 | 66 | 66 | 40 | 26 |
| A2 | 66 | 66 | 0 | 66 |
| A3 | 66 | 66 | 0 | 66 |

## A0/A1/A2/A3 metrics (DEV)

| Condition | scored | errored | accuracy | macro-F1 |
|---|---|---|---|---|
| A0 | 66 | 0 | 0.7424 | 0.6042 |
| A1 | 40 | 26 | 0.8000 | 0.6875 |
| A2 | 0 | 66 | 0.0000 | 0.0000 |
| A3 | 0 | 66 | 0.0000 | 0.0000 |

**A2 and A3 macro-F1 above (if shown) are computed over zero scored predictions and are not meaningful** — they do not represent the model's actual causal performance under those conditions, only the fact that the CLI route was down for 100% of those calls. Any deltas involving A2/A3 are an artifact of this outage, not a scientific result.

## Deltas

- A3-A0: -0.6042
- A3-A1: -0.6875
- A3-A2: 0.0000
- A1-A0: 0.0833

## Integrity checks

- web_search_requests_total: 0
- web_fetch_requests_total: 0
- subagents_spawned_total: 0
- integrity: OK — zero tool/network/subagent use across every call that returned an envelope
- memory/V0-V3 hashes: unchanged (verified via `git diff --stat memory/` showing no changes)
- FINAL_HOLDOUT: never read, scored, materialized, or inferred; `data/private/` contains only `dev_ground_truth.jsonl`

## Next step

Re-run predictions for the 158 failing (condition, number) pairs (26 in A1, 66 in A2, 66 in A3) once the CLI route's reliability is confirmed, using this run's exact frozen config (see `config.json`) and the existing resumable `scripts/run-real-dev-bakeoff.ts` (it already skips any (condition, number) pair already present in `predictions.jsonl` — but note it currently treats errored records as done; if the intent is to retry only the errored ones, filter them out of `predictions.jsonl` first, or extend the resume predicate to exclude `error !== undefined` records).
