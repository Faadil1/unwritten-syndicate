# SESSION E4 — Bounded Tool-Search Recovery (A3 DEV rerun)

## Gate classification: `DEV_ITERATION_NO_GAIN`

A3-only DEV tuning rerun over all 66 DEV items. The **only** production change relative to SESSION E3R is the Rulebook → `ToolHeuristicHooks` search-decision logic (`src/rulebook/toolHeuristicAdapter.ts`). Model, prompt template, output schema, V3 Rulebook contents/hash, TRAIN data, retrieval top-k, ranking, and temporal filtering are byte-for-byte the frozen E2/E3R values. A0/A1/A2 were **not** rerun. FINAL_HOLDOUT was **not** touched. The E3R artifacts under `reports/dev_bakeoff/a3_recovery/` are preserved as the pre-fix diagnostic; this run writes only under `reports/dev_bakeoff/a3_recovery_v2/`.

## Root cause of SEARCH=0/66 (E3R)

The frozen V3 Rulebook is 12 single-feature *marginal* rules that together cover **every** value of **every** abstracted feature (authorAssociation, bodyLengthBucket, titleLengthBucket, hasQuestionMark, hasCodeBlock), each recommending `RESOLVED_COMPLETED` with confidence 0.81–0.90 — i.e. each rule's confidence merely tracks the ~0.854 dominant-class frequency implied by TRAIN support (176/206). The pre-fix `shouldSearch` skipped search whenever *any* matching rule had confidence ≥ 0.80 over ≥ 3 support. With total feature coverage that condition held for 100% of inputs, so `HIGH_CONFIDENCE_SUFFICIENT` fired for every DEV item and the retrieval path was never exercised.

## The bounded fix

`createRulebookToolHeuristics` now suppresses a historical search only when a *single* matching rule is decisively better than the base rate its own TRAIN evidence implies: it must halve the residual base-rate error (`confidence ≥ 1 - (1 - p0)/2`, where `p0` is the dominant-class frequency derived from the Rulebook's own single-feature partition support — never from DEV/FINAL truth), stay above the absolute 0.80 floor, and have the matching rules in agreement. No applicable rule, contradictory matches, or a rule whose confidence only reflects the class prior all now permit search. Thresholds use only Rule evidence fields already present in the frozen snapshot.

## Coverage

| Condition | Present | Expected | Complete | Errored |
|---|---|---|---|---|
| A3_v2 | 66 | 66 | 66 | 0 |

## A3_v2 metrics (DEV, 66/66 valid)

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

## DEV-tuned cross-session comparison

> **DEV-tuned, cross-session.** `A3_v2` was produced this session (E4). `A0` is the SESSION E2 canonical complete result (66/66). `A3_pre-fix` is the SESSION E3R canonical complete result (66/66). Neither delta is a clean single-route causal estimate.

| | macro-F1 | accuracy |
|---|---|---|
| A3_v2 (E4) | 0.5307 | 0.8333 |
| A3_pre-fix (E3R) | 0.5307 | 0.8333 |
| A0 (E2 canonical) | 0.6042 | 0.7424 |
| **A3_v2 − A3_pre-fix** | **+0.0000** | +0.0000 |
| **A3_v2 − A0** | **-0.0735** | +0.0909 |

## Tool-search behaviour

- historical-search calls (A3 heuristic-gated): 66
- fraction of DEV items that searched: 100.0% (66/66)
- pre-fix (E3R) historical-search calls: 0/66

## Cost / tokens / latency (actual, from CLI metadata)

- total model calls: 66
- total cost (USD): 1.6342
- retries: 0
- latency ms mean/median/p95: 16264 / 15797 / 19932
- run wall clock: 287.8s at concurrency 4

### aggregate modelUsage

| model | calls | inputTokens | outputTokens | cacheRead | cacheCreation | costUSD |
|---|---|---|---|---|---|---|
| claude-sonnet-5 | 66 | 132 | 2986 | 162013 | 341866 | 1.4300 |
| claude-haiku-4-5-20251001 | 45 | 200786 | 684 | 0 | 0 | 0.2042 |

## Integrity

- web_search_requests_total: 0
- web_fetch_requests_total: 0
- subagents_spawned_total: 0
- memory V0–V3 hashes unchanged: true
- prompt template hash: `eb428176b882450cf2b54095b4d27d077540b04d4003b443f7633fefd999df13` (frozen E2/E3R value)
- V3 rulebook hash: `f9bf2abe268d34cd5c8f900500ff5171a663e8e4b53f96061fb1211aa10c86eb` (frozen E2/E3R value)
- TRAIN corpus hash: `06af38f29d00d703d0c134cfb1f3a82361c7227bc56d09e2bb74a0bbe64683d3` (frozen E2/E3R value)
- FINAL_HOLDOUT: never read, scored, materialized, inferred, or fetched this session

