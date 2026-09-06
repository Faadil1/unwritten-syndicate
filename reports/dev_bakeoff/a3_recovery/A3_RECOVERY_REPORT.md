# SESSION E3R — A3-First Recovery DEV Evaluation

## Gate classification: `A3_RECOVERY_WEAK`

A3-only deadline-recovery run over all 66 DEV items with the frozen SESSION E2 configuration. A0/A1 were **not** rerun. FINAL_HOLDOUT was **not** touched. SESSION E2 artifacts under `reports/dev_bakeoff/` are left intact; this run writes only under `reports/dev_bakeoff/a3_recovery/`.

## Coverage

| Condition | Present | Expected | Complete | Errored |
|---|---|---|---|---|
| A3 | 66 | 66 | 66 | 0 |

## A3 metrics (DEV, 66/66 valid)

| metric | value |
|---|---|
| macro-F1 | 0.5307 |
| accuracy | 0.8333 |
| scored | 66 |
| errored | 0 |

### Per-class

| label | support | precision | recall | F1 |
|---|---|---|---|---|
| RESOLVED_COMPLETED | 56 | 0.8571 | 0.9643 | 0.9076 |
| RESOLVED_NO_NEW_WORK | 10 | 0.3333 | 0.1000 | 0.1538 |

### Confusion matrix (rows = truth, cols = predicted)

| | RESOLVED_COMPLETED | RESOLVED_NO_NEW_WORK |
|---|---|---|
| RESOLVED_COMPLETED | 54 | 2 |
| RESOLVED_NO_NEW_WORK | 9 | 1 |

## Cross-session recovery comparison (A3 − A0)

> **This is a cross-session recovery comparison, not a perfect single-route causal estimate.** A3 was produced this session (E3R); A0 is the SESSION E2 canonical complete result (66/66). The incomplete SESSION E2 A1 (40/66) is **not** used for any canonical delta.

| | macro-F1 | accuracy |
|---|---|---|
| A3 (E3R) | 0.5307 | 0.8333 |
| A0 (E2 canonical) | 0.6042 | 0.7424 |
| **A3 − A0** | **-0.0735** | +0.0909 |

## Cost / tokens / latency (actual, from CLI metadata)

- total model calls: 66
- total cost (USD): 0.7111
- retries: 0
- historical-search calls (A3 heuristic-gated): 0
- latency ms mean/median/p95: 11650 / 11620 / 14290
- run wall clock: 197.4s at concurrency 4

### aggregate modelUsage

| model | calls | inputTokens | outputTokens | cacheRead | cacheCreation | costUSD |
|---|---|---|---|---|---|---|
| claude-haiku-4-5-20251001 | 53 | 111778 | 824 | 0 | 0 | 0.1159 |
| claude-sonnet-5 | 66 | 132 | 4675 | 158740 | 129121 | 0.5952 |

## Integrity

- web_search_requests_total: 0
- web_fetch_requests_total: 0
- subagents_spawned_total: 0
- memory V0–V3 hashes unchanged: true
- prompt template hash: `eb428176b882450cf2b54095b4d27d077540b04d4003b443f7633fefd999df13` (frozen E2 value)
- V3 rulebook hash: `f9bf2abe268d34cd5c8f900500ff5171a663e8e4b53f96061fb1211aa10c86eb` (frozen E2 value)
- TRAIN corpus hash: `06af38f29d00d703d0c134cfb1f3a82361c7227bc56d09e2bb74a0bbe64683d3` (frozen E2 value)
- FINAL_HOLDOUT: never read, scored, materialized, inferred, or fetched this session

