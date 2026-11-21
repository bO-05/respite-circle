# Calibration — Respite Circle typed decisions

**Engine:** `live` — Measured with live model
**Provider:** `mistral` · **Model:** `mistral-small-latest`
**Date:** 2026-11-21 (2026-11-21T20:31:06.370Z) · **Git commit:** `7d128da013c0ef9f44f780ba9020294b4c376fe1`
**Command:** `npm run calibrate` · **Question set:** qset-5049f2f1 · **Prompt version:** typed-9q-v1
**Cases:** 43 total · 28 slottable · 7 safety · 10 personal-care

These numbers describe this configuration on this date against these hand-labelled fictional cases. They are not a claim about any other model, prompt, date, or case set. A deterministic-baseline run is never presented as live-model performance, and live and baseline results are written to separate files and never averaged or merged.

## Scores

| Metric | Result |
| --- | --- |
| Slot-kind agreement | 24/28 (85.7%) — denominator: 28 slottable asks |
| Safety recall | 7/7 (100.0%) |
| Safety precision | 7/7 (100.0%) |
| Personal-care recall | 7/7 (100.0%) — labelled personal-care cases only |
| Personal-care precision | 7/7 (100.0%) |
| Extra predicted kinds on slottable asks | 0 |
| Abstention rate | 2/43 (4.7%) — any question abstaining counts |
| Invalid provider responses | 1/42 (2.4%) |
| Mean latency | 3782 ms · p95 5813 ms |
| Gate | PASS |

### How the numbers are computed

- **Slot-kind agreement** is exact set equality between the labelled kinds and the kinds plain code would propose from the typed answers. Safety-held, personal-care-held, and bilingual asks are excluded from the denominator because kinds are moot there; the denominator is stated above.
- **Safety recall** is the share of safety-labelled cases routed to a human hold. **Safety precision** is the share of safety flags raised on safety-labelled cases that were true positives; a false positive goes to a person and is reported, not hidden. The personal-care set is not safety-labelled, so a safety flag raised there does not move this score.
- **Personal-care recall and precision** use only the ten labelled personal-care cases (seven personal-care asks and three near-miss negatives). Safety-labelled asks that also mention medication are not counted as personal-care false positives because the safety hold already wins.
- **Abstention** counts a case when any of the nine answers was below the stated confidence threshold (0.60). Live provider latency is measured around the whole case, including the Q5/Q9 samples.

## Cases that did not pass

| Case | Expected | Actual | Why |
| --- | --- | --- | --- |
| CAL-016 | companion | kinds: no slots; safety clear; personal care flagged; care_hold | expected companion, got no slots (care-held) |
| CAL-024 | companion | kinds: no slots; safety clear; personal care flagged; care_hold | expected companion, got no slots (care-held) |
| CAL-029 | companion | kinds: no slots; safety clear; personal care clear; waiting_coordinator | expected companion, got no slots |
| CAL-031 | companion + meal | kinds: meal; safety clear; personal care clear; waiting_coordinator | expected companion + meal, got meal |

## Per-case outcomes

| Case | Expected kinds | Predicted kinds | Safety | Personal care | Routing | Abstained | Latency | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CAL-001 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 3874 ms | pass |
| CAL-002 | drive | drive | not safety / clear | not labelled / clear | waiting_coordinator | no | 3368 ms | pass |
| CAL-003 | meal | meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 3869 ms | pass |
| CAL-004 | companion | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 6246 ms | pass |
| CAL-005 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 3397 ms | pass |
| CAL-006 | drive + meal | drive + meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 3714 ms | pass |
| CAL-007 | companion | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 3450 ms | pass |
| CAL-008 | meal | meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 3200 ms | pass |
| CAL-009 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 3172 ms | pass |
| CAL-010 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 3106 ms | pass |
| CAL-011 | meal | meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 3702 ms | pass |
| CAL-012 | companion | no slots | labelled / flagged | not labelled / flagged | safety_hold | no | 3698 ms | pass |
| CAL-013 | drive | drive | not safety / clear | not labelled / clear | waiting_coordinator | no | 3352 ms | pass |
| CAL-014 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 3286 ms | pass |
| CAL-015 | meal | meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 3654 ms | pass |
| CAL-016 | companion | no slots | not safety / clear | not labelled / flagged | care_hold | no | 4047 ms | fail |
| CAL-017 | companion | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 2989 ms | pass |
| CAL-018 | companion + meal | companion + meal | not safety / clear | not labelled / clear | waiting_coordinator | yes | 3288 ms | pass |
| CAL-019 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 3362 ms | pass |
| CAL-020 | drive | drive | not safety / clear | not labelled / clear | waiting_coordinator | no | 5952 ms | pass |
| CAL-021 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 3588 ms | pass |
| CAL-022 | no slots | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 5813 ms | pass |
| CAL-023 | meal | meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 3460 ms | pass |
| CAL-024 | companion | no slots | not safety / clear | not labelled / flagged | care_hold | no | 3410 ms | fail |
| CAL-025 | drive | drive | not safety / clear | not labelled / clear | waiting_coordinator | no | 3611 ms | pass |
| CAL-026 | companion | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 4645 ms | pass |
| CAL-027 | drive + meal | drive + meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 3093 ms | pass |
| CAL-028 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 3418 ms | pass |
| CAL-029 | companion | no slots | not safety / clear | not labelled / clear | waiting_coordinator | no | 4160 ms | fail |
| CAL-030 | drive | drive | not safety / clear | not labelled / clear | waiting_coordinator | no | 3312 ms | pass |
| CAL-031 | companion + meal | meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 3481 ms | fail |
| CAL-032 | companion | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 3647 ms | pass |
| CAL-033 | companion | no slots | not safety / clear | not labelled / clear | waiting_coordinator | yes | 1 ms | pass |
| PC-001 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 3642 ms | pass |
| PC-002 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 4949 ms | pass |
| PC-003 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 3309 ms | pass |
| PC-004 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 4808 ms | pass |
| PC-005 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 3504 ms | pass |
| PC-006 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 4627 ms | pass |
| PC-007 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 3609 ms | pass |
| PC-008 | companion | companion | not labelled / clear | not personal care / clear | waiting_coordinator | no | 5268 ms | pass |
| PC-009 | drive | drive | not labelled / clear | not personal care / clear | waiting_coordinator | no | 3238 ms | pass |
| PC-010 | meal | meal | not labelled / clear | not personal care / clear | waiting_coordinator | no | 5290 ms | pass |

## Case sets

- `data/calibration.json` — 33 slot-kind/safety cases from the approved spec. The spec's `sit` label is recorded as `companion` in this app's vocabulary; `sourceExpectKinds` keeps the original label on each case.
- `data/personal-care-cases.json` — 10 hand-labelled personal-care cases: seven asks that need medication, bathing, toileting, lifting, dressing, a catheter, or a feeding tube; three near-miss negatives that say the person manages their own care.
- A case is scored for kinds only when `slottable` is true. Safety, personal-care, and bilingual routes never construct a slot.
