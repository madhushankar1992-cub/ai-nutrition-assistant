# Prompt Iteration Log

Documents each `systemPrompt.ts` change and its measured before/after effect on `npm run eval`, per implementation-plan.md Phase 9. Raw logs: [failure-log-before-iteration.md](failure-log-before-iteration.md) (baseline) and [failure-log.md](failure-log.md) (current).

---

## Iteration 1

**Prompt version:** `7939902e9b` → `eabb1ca8b1`

**Change:** Added to the ANSWER STYLE section of `lib/systemPrompt.ts`:

> Answer only what was asked. Do not add supplementary detail about related populations, edge cases, or worked examples (e.g. pregnancy-specific values, per-bodyweight calculations, athlete-specific notes) unless the question specifically asks for them. This is required even though such detail is accurate and relevant — the same question asked again must get an answer covering the same core facts, and optional elaboration you sometimes include and sometimes omit breaks that consistency.

**Why:** The baseline run showed `numeric_drift` on 5/10 questions. Reading the actual diffs (not just the counts) showed the root cause wasn't factual inconsistency — it was the model *optionally* tacking on extra, accurate-but-unrequested detail (e.g. pregnancy RDA values on a general vitamin C question) on some runs and not others, which the numeric-diff check correctly flags as drift since the claim sets differ in size.

**Result:**

| Category | Before | After |
|---|---|---|
| numeric_drift | 5 | 4 |
| unsupported_claim | 0 (not automatable — requires manual review, none flagged) | 0 |
| broken_source | 0 | 0 |
| missed_refusal | 0 | 0 |
| unhelpful_hedging | 0 | 0 |
| Scope suite (8 cases) | 8/8 pass | 8/8 pass |

Per-question detail:

| Question | Before | After |
|---|---|---|
| q1-nutrient-vitc | drifted (one run added pregnancy/lactation values) | **fixed** |
| q9-ambiguous-superfood | drifted (stray number in one run) | **fixed** |
| q2-nutrient-protein | drifted (all 3 attempts differed) | improved — 2 of 3 attempts now match exactly; one attempt still adds an extra athlete-range figure |
| q4-safety-eggs | drifted (inconsistent inclusion of the 40°F storage temp and the "2-4 days for cracked eggs" note) | unchanged — same drift persists; root cause is a different one (an optional *safety reminder*, not a population/edge-case aside) that this iteration's instruction didn't target |
| q5-safety-leftovers | clean | new minor drift — one run said 75°C where the other two said 74°C for a 165°F conversion; a rounding difference, not a factual disagreement, and not something this prompt change plausibly caused |
| q3, q6, q7, q8 (partial) | clean / trivial | clean / trivial (unchanged) |

**Verdict:** Net improvement (5 → 4 failing questions), with the two questions matching this iteration's specific mechanism (optional population/edge-case asides) both resolved. `q4`'s drift needs a distinct fix — the model should consistently either always or never include the storage-temperature reminder — a candidate for Iteration 2, not required to close out Phase 9's exit criteria (which asks for one documented cycle, not zero drift).

Scope compliance (the hard gate) and schema/source enforcement stayed at 100% across both versions — this iteration only affected substance consistency, not safety behavior.
