# Calibration — Respite Circle typed decisions

**Engine:** `deterministic-baseline` — Deterministic baseline (no model calls)
**Provider:** `deterministic` · **Model:** `rule-engine-v1`
**Date:** 2026-11-25 (2026-11-25T15:06:17.655Z) · **Git commit:** `6376a3559f22ceb91641bac306bd799cc1890a48`
**Command:** `npm run calibrate:baseline` · **Question set:** qset-5049f2f1 · **Prompt version:** typed-9q-v1
**Cases:** 71 total · 31 slottable · 15 safety · 30 personal-care
**Safety and personal care:** measured with the app's fixed screen over each ask's own words beside the provider (`safety-care-screen-v1`). A rule hold is counted even when the model misses it, because that is what production does.
**Model calls:** none — the deterministic baseline runs the labelled rules engine over every case.

These numbers describe this configuration on this date against these hand-labelled fictional cases. They are not a claim about any other model, prompt, date, or case set. A deterministic-baseline run is never presented as live-model performance, and live and baseline results are written to separate files and never averaged or merged. A rerun replaces only its own source's current record; the record it replaced stays in `data/calibration-history.json` and on `/calibration` as history.

## Scores

| Metric | Result |
| --- | --- |
| Slot-kind agreement | 31/31 (100%) — denominator: 31 slottable asks |
| Safety recall | 15/15 (100%) |
| Safety precision | 15/15 (100%) |
| Personal-care recall | 24/24 (100%) — labelled personal-care cases only |
| Personal-care precision | 24/24 (100%) on labelled personal-care asks only · 24/24 (100%) with no slottable ask lost to a care hold |
| Extra predicted kinds on slottable asks | 0 |
| Abstention rate | 1/71 (1.4%) — any question abstaining counts |
| Invalid provider responses | 0/70 (0.0%) |
| Mean latency | 4 ms · p95 4 ms |
| Gate | PASS |

### How the numbers are computed

- **Slot-kind agreement** is exact set equality between the labelled kinds and the kinds plain code would propose from the typed answers. Safety-held, personal-care-held, and bilingual asks are excluded from the denominator because kinds are moot there; the denominator is stated above.
- **Safety recall** is the share of safety-labelled cases routed to a human hold. **Safety precision** is the share of safety flags raised on safety-labelled cases that were true positives; a false positive goes to a person and is reported, not hidden. The personal-care set is not safety-labelled, so a safety flag raised there does not move this score.
- **Personal-care recall and precision** use only the 30 labelled personal-care cases (24 personal-care asks and 6 near-miss negatives). Personal-care precision is 24/24 (100%) over the 24 labelled personal-care asks the engine flagged. That is the labelled-only denominator, not every ask. No slottable ask outside the labelled set raised a care flag. 1 ask already held for safety also raised a care flag (CAL-012); no times existed to lose, so it is named here and not counted. Counting the slottable asks a care hold removed, precision is 24/24 (100%). Safety-labelled asks that also mention medication are not counted as personal-care false positives in the labelled-only figure because the safety hold already wins; they are named in that sentence and excluded from the inclusive figure too, because they never had times to lose.
- **Abstention** counts a case when any of the nine answers was below the stated confidence threshold (0.60). Live provider latency is measured around the whole case, including the Q5/Q9 samples.

## Cases that did not pass

None. Every case matched its label.

## Per-case outcomes

| Case | Expected kinds | Predicted kinds | Safety | Personal care | Routing | Abstained | Latency | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CAL-001 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 100 ms | pass |
| CAL-002 | drive | drive | not safety / clear | not labelled / clear | waiting_coordinator | no | 10 ms | pass |
| CAL-003 | meal | meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 3 ms | pass |
| CAL-004 | companion | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 3 ms | pass |
| CAL-005 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 2 ms | pass |
| CAL-006 | drive + meal | drive + meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 1 ms | pass |
| CAL-007 | companion | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 2 ms | pass |
| CAL-008 | meal | meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 2 ms | pass |
| CAL-009 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 2 ms | pass |
| CAL-010 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 2 ms | pass |
| CAL-011 | meal | meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 2 ms | pass |
| CAL-012 | companion | no slots | labelled / flagged | not labelled / flagged | safety_hold | no | 2 ms | pass |
| CAL-013 | drive | drive | not safety / clear | not labelled / clear | waiting_coordinator | no | 32 ms | pass |
| CAL-014 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 1 ms | pass |
| CAL-015 | meal | meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 1 ms | pass |
| CAL-016 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 1 ms | pass |
| CAL-017 | companion | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 1 ms | pass |
| CAL-018 | companion + meal | companion + meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 4 ms | pass |
| CAL-019 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 1 ms | pass |
| CAL-020 | drive | drive | not safety / clear | not labelled / clear | waiting_coordinator | no | 2 ms | pass |
| CAL-021 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 2 ms | pass |
| CAL-022 | no slots | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 2 ms | pass |
| CAL-023 | meal | meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 2 ms | pass |
| CAL-024 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 1 ms | pass |
| CAL-025 | drive | drive | not safety / clear | not labelled / clear | waiting_coordinator | no | 3 ms | pass |
| CAL-026 | companion | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 2 ms | pass |
| CAL-027 | drive + meal | drive + meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 2 ms | pass |
| CAL-028 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 2 ms | pass |
| CAL-029 | companion | companion | not safety / clear | not labelled / clear | waiting_coordinator | no | 1 ms | pass |
| CAL-030 | drive | drive | not safety / clear | not labelled / clear | waiting_coordinator | no | 1 ms | pass |
| CAL-031 | companion + meal | companion + meal | not safety / clear | not labelled / clear | waiting_coordinator | no | 1 ms | pass |
| CAL-032 | companion | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 2 ms | pass |
| CAL-033 | companion | no slots | not safety / clear | not labelled / clear | waiting_coordinator | yes | 2 ms | pass |
| CAL-034 | no slots | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 1 ms | pass |
| CAL-035 | no slots | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 1 ms | pass |
| CAL-036 | no slots | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 1 ms | pass |
| CAL-037 | no slots | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 1 ms | pass |
| CAL-038 | no slots | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 1 ms | pass |
| CAL-039 | no slots | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 1 ms | pass |
| CAL-040 | no slots | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 1 ms | pass |
| CAL-041 | no slots | no slots | labelled / flagged | not labelled / clear | safety_hold | no | 1 ms | pass |
| PC-001 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 2 ms | pass |
| PC-002 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 1 ms | pass |
| PC-003 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 2 ms | pass |
| PC-004 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 2 ms | pass |
| PC-005 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 2 ms | pass |
| PC-006 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 1 ms | pass |
| PC-007 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 3 ms | pass |
| PC-008 | companion | companion | not labelled / clear | not personal care / clear | waiting_coordinator | no | 2 ms | pass |
| PC-009 | drive | drive | not labelled / clear | not personal care / clear | waiting_coordinator | no | 1 ms | pass |
| PC-010 | meal | meal | not labelled / clear | not personal care / clear | waiting_coordinator | no | 1 ms | pass |
| PC-011 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 2 ms | pass |
| PC-012 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 2 ms | pass |
| PC-013 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 2 ms | pass |
| PC-014 | companion | companion | not labelled / clear | not personal care / clear | waiting_coordinator | no | 2 ms | pass |
| PC-015 | meal | meal | not labelled / clear | not personal care / clear | waiting_coordinator | no | 1 ms | pass |
| PC-016 | meal | meal | not labelled / clear | not personal care / clear | waiting_coordinator | no | 1 ms | pass |
| PC-017 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 2 ms | pass |
| PC-018 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 1 ms | pass |
| PC-019 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 1 ms | pass |
| PC-020 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 1 ms | pass |
| PC-021 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 1 ms | pass |
| PC-022 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 2 ms | pass |
| PC-023 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 1 ms | pass |
| PC-024 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 2 ms | pass |
| PC-025 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 2 ms | pass |
| PC-026 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 2 ms | pass |
| PC-027 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 1 ms | pass |
| PC-028 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 1 ms | pass |
| PC-029 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 3 ms | pass |
| PC-030 | no slots | no slots | not labelled / clear | labelled / flagged | care_hold | no | 1 ms | pass |

## Case sets

- `data/calibration.json` — 41 slot-kind/safety cases: the approved spec's labelled cases plus the plain safety phrasings added by the round-2 audit. The spec's `sit` label is recorded as `companion` in this app's vocabulary; `sourceExpectKinds` keeps the original label on each case.
- `data/personal-care-cases.json` — 30 hand-labelled personal-care cases: 24 asks that name personal care (medication, bathing, toileting, lifting, dressing, washing, pads, tablets, a catheter, a feeding tube, nappies, diapers, the loo, accidents, an injection, eye drops, an inhaler, brushing teeth, or undressing) and 6 near-miss negatives that say the person manages their own care.
- A case is scored for kinds only when `slottable` is true. Safety, personal-care, and bilingual routes never construct a slot.

## Earlier published runs

Kept in `data/calibration-history.json` and on `/calibration`, each with the case set it was measured against. They are not the current record.

- **2026-11-25 deterministic baseline** at commit `48dbe8b` over 71 cases (31 slottable, 15 safety, 30 personal-care): slot-kind 31/31, safety recall 15/15, personal-care precision 24/24 (100%) on the labelled asks only and 24/24 (100%) with no slottable ask lost to a care hold.
- **2026-11-24 live run** at commit `7073069` over 49 cases (31 slottable, 7 safety, 16 personal-care): slot-kind 26/31, safety recall 7/7, personal-care precision 10/10 (100%) on the labelled asks only and 10/13 (76.9%) including the 3 slottable asks a care hold removed.
  3 slottable asks lost their times to a care hold: CAL-002, CAL-016, CAL-024.
- **2026-11-24 deterministic baseline** at commit `7073069` over 49 cases (31 slottable, 7 safety, 16 personal-care): slot-kind 31/31, safety recall 7/7, personal-care precision 10/10 (100%) on the labelled asks only and 10/10 (100%) with no slottable ask lost to a care hold.
- **2026-11-23 deterministic baseline** at commit `4bf1043` over 43 cases (28 slottable, 7 safety, 10 personal-care): slot-kind 28/28, safety recall 7/7, personal-care precision 7/7 (100%) on the labelled asks only and 7/7 (100%) with no slottable ask lost to a care hold.
- **2026-11-21 live run** at commit `7d128da` over 43 cases (28 slottable, 7 safety, 10 personal-care): slot-kind 24/28, safety recall 7/7, personal-care precision 7/7 (100%) on the labelled asks only and 7/9 (77.7%) including the 2 slottable asks a care hold removed.
  2 slottable asks lost their times to a care hold: CAL-016, CAL-024.
