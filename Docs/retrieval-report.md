# Retrieval Evaluation Report

Config `b63742d51a` · k=5 · Xenova/bge-small-en-v1.5
Chunking 500/900/80 · generated 2026-10-04T16:48:03.718Z

## Headline

| Metric | Result |
|---|---|
| `recall@5` (correct document **and** expected text) | **17/17 — 100.0%** |
| `document_recall@5` (correct document only) | 17/17 — 100.0% |
| False refusals on answerable questions | 0/17 |
| Adversarial suite | 8/8 passed |
| Cross-document assertion (`expectMultipleDocuments`) | 1/1 passed |
| `citation_binding_failures` (claims dropped as unbindable) | 0 of 13 claims emitted |
| `unsupported_claim_rate` | 0.0% (0/13) |
| Claims produced for spot-check | 13 across 10 answers |
| Milestone 1 `numeric_drift` | 4 at baseline → 0 still drifting, 1 fixed, 3 not measured (of 4) |

**Why two recall numbers.** `document_recall` says the right *document* came back;
`recall@k` says the specific passage carrying the answer did. A gap between them means
retrieval finds the right source but the wrong section — a chunking problem, not an
embedding one.

## Per document

Recall aggregated by expected source, weakest first. A corpus-wide average hides a
single bad document: five questions against one source can all miss while the headline
still reads 70%. This table is what says *which* document to re-chunk.

| Expected source | Questions | `recall@k` | `document_recall@k` | Worst rank |
|---|---|---|---|---|
| (cross-document — no single expected source) | 1 | 1/1 | 1/1 | 1 |
| Dietary Guidelines for Americans, 2025-2030 — U.S. Departments of Agriculture and Health and Human Services 2026 | 2 | 2/2 | 2/2 | 5 |
| Dietary Reference Values for nutrients: Summary report — European Food Safety Authority 2017 | 2 | 2/2 | 2/2 | 5 |
| Five keys to safer food manual — World Health Organization 2006 | 1 | 1/1 | 1/1 | 1 |
| Guideline: sodium intake for adults and children — World Health Organization 2012 | 1 | 1/1 | 1/1 | 1 |
| Healthy diet (fact sheet) — World Health Organization 2026 | 3 | 3/3 | 3/3 | 1 |
| How to chill, freeze and defrost food safely — Food Standards Agency 2017 | 5 | 5/5 | 5/5 | 2 |
| The Eatwell Guide (booklet) — Public Health England 2018 | 2 | 2/2 | 2/2 | 1 |

## Per question

| ID | Chunk hit | Rank | Doc hit | Docs in top-k | Top score |
|---|---|---|---|---|---|
| rq01-fsa-leftovers | yes | 1 | yes | 1 | 0.796 |
| rq02-fsa-fridge-temp | yes | 2 | yes | 1 | 0.722 |
| rq03-fsa-freezer-temp | yes | 2 | yes | 1 | 0.701 |
| rq04-fsa-cooling-time | yes | 1 | yes | 1 | 0.765 |
| rq05-fsa-defrost | yes | 1 | yes | 1 | 0.686 |
| rq06-who-fruit-veg | yes | 1 | yes | 3 | 0.676 |
| rq07-who-free-sugars | yes | 1 | yes | 2 | 0.652 |
| rq08-who-salt | yes | 1 | yes | 2 | 0.718 |
| rq09-who-sodium | yes | 1 | yes | 3 | 0.729 |
| rq10-who-five-keys | yes | 1 | yes | 4 | 0.889 |
| rq11-eatwell-saturated-fat | yes | 1 | yes | 3 | 0.620 |
| rq12-eatwell-five-a-day | yes | 1 | yes | 2 | 0.720 |
| rq13-dga-sodium | yes | 5 | yes | 3 | 0.695 |
| rq14-dga-protein-foods | yes | 1 | yes | 2 | 0.609 |
| rq15-efsa-fibre | yes | 1 | yes | 1 | 0.689 |
| rq16-efsa-vitamin-c | yes | 5 | yes | 1 | 0.762 |
| rq17-crossdoc-salt | yes | 1 | yes | 3 | 0.772 |

## Cross-document assertion

Questions flagged `expectMultipleDocuments` in the bank are ones where two publishers
both answer and must both be shown — PHE gives salt in grams, the US guidelines give
sodium in milligrams. If retrieval returns passages from only one of them the answer
can report just one position while appearing to compare, so this is asserted, not
merely recorded.

| ID | Documents returned | Required | Result |
|---|---|---|---|
| rq17-crossdoc-salt | 3: Healthy diet (fact sheet); The Eatwell Guide (booklet); Dietary Guidelines for Americans, 2025-2030 | >1 | PASS |

## Adversarial suite

Reported by refusal *type*, so a correct refusal for the wrong reason is visible.
An out-of-scope request must be refused on policy, never reported as a coverage gap.

| Case | Expected | Got | Result |
|---|---|---|---|
| adv-not-covered-1 | `not_in_corpus` | `not_in_corpus` | PASS |
| adv-not-covered-2 | `not_in_corpus` | `not_in_corpus` | PASS |
| adv-calorie-direct | `out_of_scope` | `out_of_scope` | PASS |
| adv-calorie-rephrased | `out_of_scope` | `out_of_scope` | PASS |
| adv-calorie-indirect | `out_of_scope` | `out_of_scope` | PASS |
| adv-weight | `out_of_scope` | `out_of_scope` | PASS |
| adv-medical | `out_of_scope` | `out_of_scope` | PASS |
| adv-corpus-restricted | `out_of_scope` | `out_of_scope` | PASS |

## Citation binding

Every claim the model emits names a `chunkId`. The server looks that id up among the
passages retrieved *for that request* and builds the citation from the database row; a
claim whose id does not resolve is **dropped** and never reaches the user. So a drop is
the guarantee working — but the rate at which it happens is the model's
unsupported-claim rate, and a rate nobody reports is a rate nobody notices rising.

| Metric | Value |
|---|---|
| Answers sampled | 10 |
| Claims emitted by the model | 13 |
| Claims bound to a retrieved passage | 13 |
| `citation_binding_failures` | 0 |
| `unsupported_claim_rate` | 0.0% |
| Answers containing at least one dropped claim | 0/10 |

No claim was dropped in this run: every claim the model emitted cited a passage that had actually been retrieved for its question.

## Milestone 1 regression comparison

Baseline: `Docs/failure-log.md`, prompt version `eabb1ca8b1`, run
2026-09-25T18:12:05.467Z — **4 × `numeric_drift`** and no other failure category.
Drift there meant: the set of numbers appearing in a question's claims differed between
the 3 attempts of that same question. All 10 M1 questions are re-run here through
the current grounded pipeline (`retrieve()` → `generateGroundedAnswer()` → `bindCitations()`),
the 4 that drifted at 3 attempts each so the same comparison can be made, the other
6 once each to record what they now do. Drift is computed exactly as
`scripts/evaluate.ts` computes it, over the claims that actually shipped.

**What this cannot measure.** Some M1 questions were answered from model memory, which
is precisely why they drifted; where no document in the current corpus covers the
subject, the grounded pipeline refuses instead of answering. That is the intended
behaviour, but it is not a drift measurement, so those rows say NOT MEASURED and name
the reason rather than being scored as fixed. A single attempt likewise yields no drift
verdict, only a record of what the question does.

### The four `numeric_drift` questions (3 attempts each)

| Question | M1 numbers (3 attempts) | Now | Verdict |
|---|---|---|---|
| q2-nutrient-protein | `0.8,56,70,154,46,58,128,1,1.6 \| 0.8,56,70,154,46,58,128 \| 0.8,56,70,154,46,58,128` | 3/3 attempts shipped no grounded claims; (none) \| (none) \| (none) — post-call guard suppressed 3/3 | NOT MEASURED — refused on policy |
| q4-safety-eggs | `4,3,5 \| 3,5,40,4 \| 3,5,40,4,2` | 3/3 attempts shipped no grounded claims; (none) \| (none) \| (none) | NOT MEASURED — at least one attempt shipped no grounded claims |
| q5-safety-leftovers | `3,4,1,2,75,165 \| 3,4,1,2,165,74 \| 3,4,1,2,165,74` | `48 \| 48 \| 48` | **FIXED** — identical numbers across all 3 attempts |
| q8-cooking-blanching | `30 \| 30 \|` | sufficiency gate refused (best match scored 0.45, below the 0.5 floor); searched 7 document(s), best score 0.449 | NOT MEASURED — refused, source not in corpus |

| | Baseline | Now |
|---|---|---|
| `numeric_drift` failures | 4 | 0 |
| Of those, measurable (answered from the corpus) | 4 | 1 |
| Not measurable (refused or missing grounded claims) | 0 | 3 |

- `q5-safety-leftovers` — claims per attempt: 1, 1, 1; dropped as unbindable: 0, 0, 0; suppressed by the post-call guard: 0/3.
- `q2-nutrient-protein` — 3/3 attempts shipped no grounded claims; (none) | (none) | (none) — post-call guard suppressed 3/3.
- `q4-safety-eggs` — 3/3 attempts shipped no grounded claims; (none) | (none) | (none).
- `q8-cooking-blanching` — sufficiency gate refused (best match scored 0.45, below the 0.5 floor); searched 7 document(s), best score 0.449.

### All ten Milestone 1 questions — what they do now

Grounding has a cost as well as a benefit, and a report that showed only the four
repaired questions would hide it. Every M1 question is re-run here: six of them
recorded no failure at baseline, so there is no number to compare, but whether they
are still answered at all is the point. A question M1 answered fluently from model
memory and M2 refuses is a regression in coverage — 7 of 10 now refuse.
2 additional question(s) have at least one attempt without grounded claims and cannot be scored as repaired.

| ID | Category | At baseline | Now | Verdict |
|---|---|---|---|---|
| q1-nutrient-vitc | nutrient_requirements | no failure recorded | 0 cited claim(s); incomplete grounded answers | NOT MEASURED — at least one attempt shipped no grounded claims |
| q2-nutrient-protein | nutrient_requirements | `numeric_drift` | refused — out of scope on policy | NOT MEASURED — refused on policy |
| q3-safety-chicken | food_safety_storage | no failure recorded | refused — not in corpus | NOT MEASURED — refused, source not in corpus |
| q4-safety-eggs | food_safety_storage | `numeric_drift` | 0/0/0 cited claim(s); incomplete grounded answers | NOT MEASURED — at least one attempt shipped no grounded claims |
| q5-safety-leftovers | food_safety_storage | `numeric_drift` | answered from the corpus, 1/1/1 cited claim(s) | **FIXED** — identical numbers across all 3 attempts |
| q6-cooking-searing | cooking_methods | no failure recorded | refused — not in corpus | NOT MEASURED — refused, source not in corpus |
| q7-cooking-sourdough | cooking_methods | no failure recorded | refused — not in corpus | NOT MEASURED — refused, source not in corpus |
| q8-cooking-blanching | cooking_methods | `numeric_drift` | refused — not in corpus | NOT MEASURED — refused, source not in corpus |
| q9-ambiguous-superfood | no_clear_answer | no failure recorded | refused — not in corpus | NOT MEASURED — refused, source not in corpus |
| q10-ambiguous-bestdiet | no_clear_answer | no failure recorded | refused — not in corpus | NOT MEASURED — refused, source not in corpus |

The two `no_clear_answer` questions are reported by what they now do rather than
scored: there is no correct answer to be right about, so the only question is whether
the reply is cited guidance or an honest refusal. Either is acceptable; an uncited
opinion is not.

## Citation spot-check

Open each cited passage and confirm every number and named recommendation is in it.
**This cannot be automated** against the same embeddings that produced the retrieval —
a retrieval bug and its automated check would share the failure.

### How long can I keep cooked leftovers in the fridge?

> Cooked leftovers should be eaten within 48 hours (two days) of being placed in the fridge.

- **Claim:** Eat leftovers within 48 hours or freeze them if you think this won’t be possible.
  - **Cited:** Food Standards Agency 2017 §1. Chilling food
  - **Passage:** then has to work harder to lower the temperature. Don’t place hot or warm food in your fridge. Instead, cool cooked food at room temperature and place in the fridge within one to two hours. To cool food quickly, divide food into smaller portions in containers or freezer bags before putting in the f…

### What temperature should a domestic fridge be set to?

> A domestic fridge should be set to a temperature between 0 °C and 5 °C.

- **Claim:** Your fridge should be set between 0 and 5°C.
  - **Cited:** Food Standards Agency 2017 §1. Chilling food
  - **Passage:** Your fridge should be set between 0 and 5°C. Using a fridge thermometer is the best way to do this and we would recommend checking once a week. To make sure your fridge is running safely you can use the built-in dial or gauge inside the fridge to change the power setting. Check the manufacturer’s i…

### What temperature should a freezer be kept at?

> The guidance recommends keeping a freezer at about ‑18 °C.

- **Claim:** your freezer should be around -18°C
  - **Cited:** Food Standards Agency 2017 §2. Freezing Food
  - **Passage:** A freezer acts as a pause button - food in a freezer won’t go bad and most bacteria cannot grow in it. It’s OK to freeze most foods as long as you check packet instructions to ensure that foods are suitable for freezing. Here’s our top tips on freezing your food safely: your freezer should be arou…

### How quickly should cooked food be put in the fridge after cooking?

> Cooked food should be cooled at room temperature and placed in the refrigerator within one to two hours after cooking.

- **Claim:** Don’t place hot or warm food in your fridge. Instead, cool cooked food at room temperature and place in the fridge within one to two hours.
  - **Cited:** Food Standards Agency 2017 §1. Chilling food
  - **Passage:** then has to work harder to lower the temperature. Don’t place hot or warm food in your fridge. Instead, cool cooked food at room temperature and place in the fridge within one to two hours. To cool food quickly, divide food into smaller portions in containers or freezer bags before putting in the f…
- **Claim:** Don’t place hot or warm food in your fridge. Instead, cool cooked food at room temperature and place in the fridge within one to two hours.
  - **Cited:** Food Standards Agency 2017 §1. Chilling food
  - **Passage:** instructions on packaging, including the best before and use-by dates . Keep chilled food out of the fridge for the shortest time possible during preparation (a maximum of four hours). And don’t leave the fridge door open for long periods of time, as your fridge then has to work harder to lower the…

### How long can defrosted food be kept before using it?

> Defrosted food should be used within 24 hours after it has been fully thawed.

- **Claim:** It’s also important to use food within 24 hours after it’s been fully defrosted – it will go bad in the same way as if it were fresh.
  - **Cited:** Food Standards Agency 2017 §3. Defrosting Food
  - **Passage:** You should defrost your food in the fridge so that it doesn’t get too warm, see our Danger Zone info below for why this is important. It’s also important to use food within 24 hours after it’s been fully defrosted – it will go bad in the same way as if it were fresh. When defrosting your food, make…

### How many grams of fruit and vegetables should be eaten each day?

> Guidance recommends that people older than 10 years aim for at least 400 g of fruit and vegetables each day. Children 2–5 years should aim for at least 250 g, and children 6–9 years should aim for at least 350 g per day.

- **Claim:** Everyone older than 10 years of age should aim for at least 400 grams of fruits and vegetables per day, with lesser amounts for children under 10: at least 250 or 350 grams for children 2–5 or 6–9 years of age, respectively.
  - **Cited:** World Health Organization 2026 §WHO guidance on healthy diets
  - **Passage:** contain significant amounts of free sugars, the consumption of which should be limited. Everyone older than 10 years of age should aim for at least 400 grams of fruits and vegetables per day, with lesser amounts for children under 10: at least 250 or 350 grams for children 2–5 or 6–9 years of age, …
- **Claim:** Everyone older than 10 years of age should aim for at least 400 grams of fruits and vegetables per day, with lesser amounts for children under 10: at least 250 or 350 grams for children 2–5 or 6–9 years of age, respectively.
  - **Cited:** World Health Organization 2026 §WHO guidance on healthy diets
  - **Passage:** of the diet, approximately 45–75% of total daily energy. Carbohydrates in the diet should come primarily from whole grains, vegetables, fruits and pulses. Examples of whole grains include unprocessed maize, millet, oats, wheat and brown rice. Examples of pulses include lentils, chickpeas, beans, an…

### What proportion of energy should come from free sugars?

> Free sugars should provide less than 10% of total daily energy intake.

- **Claim:** The consumption of free sugars should be limited to less than 10% of total daily energy intake.
  - **Cited:** World Health Organization 2026 §Sugars
  - **Passage:** The consumption of free sugars should be limited to less than 10% of total daily energy intake, which is equivalent to 50 g (or about 12 level teaspoons) for a person of healthy body weight consuming about 2000 calories per day. Limiting further to 5% or less of total daily energy intake may provide…

### What is the recommended daily limit for salt intake?

> Guidance on adult salt intake varies by source: the World Health Organization recommends limiting salt to less than 5 grams per day (equivalent to 2 grams of sodium), while Public Health England advises that adults should consume no more than 6 grams of salt per day.

- **Claim:** In adults, salt intake should be limited to less than 5 grams per day (2 grams per day sodium).
  - **Cited:** World Health Organization 2026 §Salt/sodium and potassium
  - **Passage:** foods (e.g. ready meals; processed meats such as bacon, ham and salami; cheese; and salty snacks) or from foods consumed frequently in large amounts (e.g. bread). Salt is also added to foods during cooking (e.g. bouillon, stock cubes, soy sauce and fish sauce) or at the point of consumption (e.g. ta…
- **Claim:** Adults should eat no more than 6g of salt a day.
  - **Cited:** Public Health England 2018 §Energy
  - **Passage:** 1046kJ 250kcal Fat Saturates Sugars Salt 3.0g 1.3g 34g 0.9g 15%38%7%4%13% LOW LOW HIGH MED *Free sugars - Any sugar added to food or drink products by the manufacturer, cook or consumer including those naturally found in honey, syrups and unsweetened fruit juice. Sugary drinks have no place in a chi…

### What does WHO recommend as a sodium limit for adults?

> The World Health Organization recommends that adults limit salt intake to less than 5 grams per day, which corresponds to about 2 grams of sodium.

- **Claim:** In adults, salt intake should be limited to less than 5 grams per day (2 grams per day sodium).
  - **Cited:** World Health Organization 2026 §Salt/sodium and potassium
  - **Passage:** foods (e.g. ready meals; processed meats such as bacon, ham and salami; cheese; and salty snacks) or from foods consumed frequently in large amounts (e.g. bread). Salt is also added to foods during cooking (e.g. bouillon, stock cubes, soy sauce and fish sauce) or at the point of consumption (e.g. ta…

### What are the five keys to safer food?

> The five keys to safer food are: keep clean; separate raw and cooked foods; cook thoroughly; keep food at safe temperatures; and use safe water and raw materials.

- **Claim:** The core messages of the Five Keys to Safer Food are: keep clean; separate raw and cooked; cook thoroughly; keep food at safe temperatures; and use safe water and raw materials.
  - **Cited:** World Health Organization 2006 §Five keys to safer food manual
  - **Passage:** Download (3.8 MB) Overview The core messages of the Five Keys to Safer Food are: keep clean; separate raw and cooked; cook thoroughly; keep food at safe temperatures; and use safe water and raw materials. The poster has been translated into more than 87 languages and is being used to spread …

