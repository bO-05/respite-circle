# Calibration — Respite Circle typed decisions

**Engine:** `live` — Measured with live model
**Provider:** `mistral` · **Model:** `mistral-small-latest`
**Date:** 2026-11-24 (2026-11-24T08:04:27.921Z) · **Git commit:** `707306953e384e5f9c94475916aad46f3bf84ba4`
**Command:** `npm run calibrate` · **Question set:** qset-5049f2f1 · **Prompt version:** typed-9q-v1
**Cases:** 49 total · 31 slottable · 7 safety · 16 personal-care

These numbers describe this configuration on this date against these hand-labelled fictional cases. They are not a claim about any other model, prompt, date, or case set. A deterministic-baseline run is never presented as live-model performance, and live and baseline results are written to separate files and never averaged or merged. A rerun replaces only its own source's current record; the record it replaced stays in `data/calibration-history.json` and on `/calibration` as history.

## Scores

| Metric | Result |
| --- | --- |
| Slot-kind agreement | 26/31 (83.8%) — denominator: 31 slottable asks |
| Safety recall | 7/7 (100%) |
| Safety precision | 7/7 (100%) |
| Personal-care recall | 10/10 (100%) — labelled personal-care cases only |
| Personal-care precision | 10/10 (100%) |
| Extra predicted kinds on slottable asks | 0 |
| Abstention rate | 1/49 (2.0%) — any question abstaining counts |
| Invalid provider responses | 2/48 (4.1%) |
| Mean latency | 3900 ms · p95 5640 ms |
| Gate | PASS |

### How the numbers are computed

- **Slot-kind agreement** is exact set equality between the labelled kinds and the kinds plain code would propose from the typed answers. Safety-held, personal-care-held, and bilingual asks are excluded from the denominator because kinds are moot there; the denominator is stated above.
- **Safety recall** is the share of safety-labelled cases routed to a human hold. **Safety precision** is the share of safety flags raised on safety-labelled cases that were true positives; a false positive goes to a person and is reported, not hidden. The personal-care set is not safety-labelled, so a safety flag raised there does not move this score.
- **Personal-care recall and precision** use only the 16 labelled personal-care cases (10 personal-care asks and 6 near-miss negatives). Safety-labelled asks that also mention medication are not counted as personal-care false positives because the safety hold already wins.
- **Abstention** counts a case when any of the nine answers was below the stated confidence threshold (0.60). Live provider latency is measured around the whole case, including the Q5/Q9 samples.

## Cases that did not pass

| Case | Expected | Actual | Why |
| --- | --- | --- | --- |
| CAL-002 | drive | kinds: no slots; safety clear; personal care flagged; care_hold | expected drive, got no slots (care-held) |
| CAL-016 | companion | kinds: no slots; safety clear; personal care flagged; care_hold | expected companion, got no slots (care-held) |
| CAL-024 | companion | kinds: no slots; safety clear; personal care flagged; care_hold | expected companion, got no slots (care-held) |
| CAL-029 | companion | kinds: no slots; safety clear; personal care clear; waiting_coordinator | expected companion, got no slots |
| CAL-031 | companion + meal | kinds: meal; safety clear; personal care clear; waiting_coordinator | expected companion + meal, got meal |

## Per-case outcomes

| Case | Expected kinds | Predicted kinds | Safety | Personal care | Routing | Abstained | Latency | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CAL-001 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 4528 ms | pass |
| CAL-002 | drive | no slots | not safety / clear | not labelled / flagged | care_hold | no | 5379 ms | fail |
| CAL-003 | meal | meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 3571 ms | pass |
| CAL-004 | companion | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 5063 ms | pass |
| CAL-005 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 3960 ms | pass |
| CAL-006 | drive + meal | drive + meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 3475 ms | pass |
| CAL-007 | companion | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 3963 ms | pass |
| CAL-008 | meal | meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 3810 ms | pass |
| CAL-009 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 5540 ms | pass |
| CAL-010 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 3525 ms | pass |
| CAL-011 | meal | meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 4311 ms | pass |
| CAL-012 | companion | no slots | labelled / flagged | not labelled / flagged | safety_hold | no | 3978 ms | pass |
| CAL-013 | drive | drive | not safety / clear | not labelled / clear | waiting_coordinator | no | 4240 ms | pass |
| CAL-014 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 3695 ms | pass |
| CAL-015 | meal | meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 3599 ms | pass |
| CAL-016 | companion | no slots | not safety / clear | not labelled / flagged | care_hold | no | 3318 ms | fail |
| CAL-017 | companion | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 4061 ms | pass |
| CAL-018 | companion + meal | companion + meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 3493 ms | pass |
| CAL-019 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 3559 ms | pass |
| CAL-020 | drive | drive | not safety / clear | not labelled / clear | waiting_coordinator | no | 5640 ms | pass |
| CAL-021 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 3638 ms | pass |
| CAL-022 | no slots | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 3565 ms | pass |
| CAL-023 | meal | meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 3624 ms | pass |
| CAL-024 | companion | no slots | not safety / clear | not labelled / flagged | care_hold | no | 4282 ms | fail |
| CAL-025 | drive | drive | not safety / clear | not labelled / clear | waiting_coordinator | no | 3435 ms | pass |
| CAL-026 | companion | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 4209 ms | pass |
| CAL-027 | drive + meal | drive + meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 3819 ms | pass |
| CAL-028 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 3431 ms | pass |
| CAL-029 | companion | no slots | not safety / clear | not labelled / clear | waiting_coordinator | no | 3738 ms | fail |
| CAL-030 | drive | drive | not safety / clear | not labelled / clear | waiting_coordinator | no | 3263 ms | pass |
| CAL-031 | companion + meal | meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 3893 ms | fail |
| CAL-032 | companion | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 3855 ms | pass |
| CAL-033 | companion | no slots | not safety / clear | not labelled / clear | waiting_coordinator | yes | 1 ms | pass |
| PC-001 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 3483 ms | pass |
| PC-002 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 4006 ms | pass |
| PC-003 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 3263 ms | pass |
| PC-004 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 5295 ms | pass |
| PC-005 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 3475 ms | pass |
| PC-006 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 3614 ms | pass |
| PC-007 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 3603 ms | pass |
| PC-008 | companion | companion | not labelled / clear | not personal care / clear | waiting_coordinator | no | 6278 ms | pass |
| PC-009 | drive | drive | not labelled / clear | not personal care / clear | waiting_coordinator | no | 3229 ms | pass |
| PC-010 | meal | meal | not labelled / clear | not personal care / clear | waiting_coordinator | no | 5988 ms | pass |
| PC-011 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 3620 ms | pass |
| PC-012 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 3628 ms | pass |
| PC-013 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 3865 ms | pass |
| PC-014 | companion | companion | not labelled / clear | not personal care / clear | waiting_coordinator | no | 3612 ms | pass |
| PC-015 | meal | meal | not labelled / clear | not personal care / clear | waiting_coordinator | no | 3492 ms | pass |
| PC-016 | meal | meal | not labelled / clear | not personal care / clear | waiting_coordinator | no | 3180 ms | pass |

## Case sets

- `data/calibration.json` — 33 slot-kind/safety cases from the approved spec. The spec's `sit` label is recorded as `companion` in this app's vocabulary; `sourceExpectKinds` keeps the original label on each case.
- `data/personal-care-cases.json` — 16 hand-labelled personal-care cases: 10 asks that name personal care (medication, bathing, toileting, lifting, dressing, washing, pads, tablets, a catheter, or a feeding tube) and 6 near-miss negatives that say the person manages their own care.
- A case is scored for kinds only when `slottable` is true. Safety, personal-care, and bilingual routes never construct a slot.
