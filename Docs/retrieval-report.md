# Retrieval Evaluation Report

Config `932717403c` · k=5 · Xenova/bge-small-en-v1.5
Chunking 500/900/80 · generated 2026-10-02T21:17:03.317Z

## Headline

| Metric | Result |
|---|---|
| `recall@5` (correct document **and** expected text) | **17/17 — 100.0%** |
| `document_recall@5` (correct document only) | 17/17 — 100.0% |
| False refusals on answerable questions | 0/17 |
| Adversarial suite | 8/8 passed |
| Claims produced for spot-check | 15 across 10 answers |

**Why two recall numbers.** `document_recall` says the right *document* came back;
`recall@k` says the specific passage carrying the answer did. A gap between them means
retrieval finds the right source but the wrong section — a chunking problem, not an
embedding one.

## Per question

| ID | Chunk hit | Rank | Doc hit | Docs in top-k | Top score |
|---|---|---|---|---|---|
| rq01-fsa-leftovers | yes | 1 | yes | 1 | 0.799 |
| rq02-fsa-fridge-temp | yes | 2 | yes | 1 | 0.717 |
| rq03-fsa-freezer-temp | yes | 2 | yes | 1 | 0.695 |
| rq04-fsa-cooling-time | yes | 1 | yes | 1 | 0.762 |
| rq05-fsa-defrost | yes | 1 | yes | 1 | 0.688 |
| rq06-who-fruit-veg | yes | 1 | yes | 3 | 0.674 |
| rq07-who-free-sugars | yes | 1 | yes | 2 | 0.650 |
| rq08-who-salt | yes | 1 | yes | 2 | 0.719 |
| rq09-who-sodium | yes | 1 | yes | 3 | 0.730 |
| rq10-who-five-keys | yes | 1 | yes | 3 | 0.887 |
| rq11-eatwell-saturated-fat | yes | 1 | yes | 3 | 0.614 |
| rq12-eatwell-five-a-day | yes | 1 | yes | 2 | 0.720 |
| rq13-dga-sodium | yes | 5 | yes | 3 | 0.691 |
| rq14-dga-protein-foods | yes | 1 | yes | 2 | 0.602 |
| rq15-efsa-fibre | yes | 1 | yes | 1 | 0.690 |
| rq16-efsa-vitamin-c | yes | 4 | yes | 1 | 0.732 |
| rq17-crossdoc-salt | yes | 1 | yes | 2 | 0.769 |

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

## Citation spot-check

Open each cited passage and confirm every number and named recommendation is in it.
**This cannot be automated** against the same embeddings that produced the retrieval —
a retrieval bug and its automated check would share the failure.

### How long can I keep cooked leftovers in the fridge?

> Cooked leftovers should be eaten within 48 hours (two days) of being placed in the fridge, or frozen if they won’t be consumed within that time.

- **Claim:** Eat leftovers within 48 hours or freeze them if you think this won’t be possible.
  - **Cited:** Food Standards Agency 2017 §1. Chilling food
  - **Passage:** then has to work harder to lower the temperature. Don’t place hot or warm food in your fridge. Instead, cool cooked food at room temperature and place in the fridge within one to two hours. To cool food quickly, divide food into smaller portions in containers or freezer bags before putting in the f…

### What temperature should a domestic fridge be set to?

> A domestic fridge should be set to a temperature between 0 °C and 5 °C.

- **Claim:** Your fridge should be set between 0 and 5°C.
  - **Cited:** Food Standards Agency 2017 §1. Chilling food
  - **Passage:** Your fridge should be set between 0 and 5°C. Using a fridge thermometer is the best way to do this and we would recommend checking once a week. To make sure your fridge is running safely you can use the built-in dial or gauge inside the fridge to change the power setting. Check the manufacturer’s i…
- **Claim:** your fridge should be between 0 and 5°C
  - **Cited:** Food Standards Agency 2017 §Applies to England, Northern Ireland and Wales
  - **Passage:** is available at https://www.gov.uk/government/publications/how-to-chill-freeze-and-defrost-food-safely/how-to-chill-freeze-and-defrost-food-safely Chilling, freezing and defrosting food properly helps stop harmful bacteria from growing. Here are our top recommendations on chilling and freezing you…

### What temperature should a freezer be kept at?

> The guidance recommends keeping a domestic freezer at about ‑18 °C.

- **Claim:** your freezer should be around -18°C
  - **Cited:** Food Standards Agency 2017 §2. Freezing Food
  - **Passage:** A freezer acts as a pause button - food in a freezer won’t go bad and most bacteria cannot grow in it. It’s OK to freeze most foods as long as you check packet instructions to ensure that foods are suitable for freezing. Here’s our top tips on freezing your food safely: your freezer should be arou…
- **Claim:** The cold temperatures of a domestic freezer (-18°C) delay chemical reactions within foods
  - **Cited:** Food Standards Agency 2017 §FSA Explains: The Danger Zone
  - **Passage:** The cold temperatures of a domestic freezer (-18°C) delay chemical reactions within foods and put any bacteria that may be present on pause. The bacteria haven’t been killed, and they may be revived as the food defrosts. Defrost food in the fridge to prevent it sitting in between 8 - 63°C, which is…

### How quickly should cooked food be put in the fridge after cooking?

> Cooked food should be cooled at room temperature and placed in the refrigerator within one to two hours after cooking.

- **Claim:** Don’t place hot or warm food in your fridge. Instead, cool cooked food at room temperature and place in the fridge within one to two hours.
  - **Cited:** Food Standards Agency 2017 §1. Chilling food
  - **Passage:** then has to work harder to lower the temperature. Don’t place hot or warm food in your fridge. Instead, cool cooked food at room temperature and place in the fridge within one to two hours. To cool food quickly, divide food into smaller portions in containers or freezer bags before putting in the f…
- **Claim:** Don’t place hot or warm food in your fridge. Instead, cool cooked food at room temperature and place in the fridge within one to two hours.
  - **Cited:** Food Standards Agency 2017 §1. Chilling food
  - **Passage:** instructions on packaging, including the best before and use-by dates . Keep chilled food out of the fridge for the shortest time possible during preparation (a maximum of four hours). And don’t leave the fridge door open for long periods of time, as your fridge then has to work harder to lower the…

### How long can defrosted food be kept before using it?

> Defrosted food should be used within 24 hours after it has been fully thawed.

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

> Guidance recommends that free sugars provide less than 10% of total daily energy intake (with an optional lower target of 5% for additional health benefits).

- **Claim:** The consumption of free sugars should be limited to less than 10% of total daily energy intake, which is equivalent to 50 g for a person of healthy body weight consuming about 2000 calories per day. Limiting further to 5% or less of total daily energy intake may provide additional health benefits.
  - **Cited:** World Health Organization 2026 §Sugars
  - **Passage:** The consumption of free sugars should be limited to less than 10% of total daily energy intake, which is equivalent to 50 g (or about 12 level teaspoons) for a person of healthy body weight consuming about 2000 calories per day. Limiting further to 5% or less of total daily energy intake may provide…

### What is the recommended daily limit for salt intake?

> Guidance on adult salt intake varies: the WHO fact sheet advises limiting salt to less than 5 grams per day, while Public Health England’s Eatwell Guide states adults should consume no more than 6 grams per day.

- **Claim:** In adults, salt intake should be limited to less than 5 grams per day (2 grams per day sodium).
  - **Cited:** World Health Organization 2026 §Salt/sodium and potassium
  - **Passage:** foods (e.g. ready meals; processed meats such as bacon, ham and salami; cheese; and salty snacks) or from foods consumed frequently in large amounts (e.g. bread). Salt is also added to foods during cooking (e.g. bouillon, stock cubes, soy sauce and fish sauce) or at the point of consumption (e.g. ta…
- **Claim:** Adults should eat no more than 6g of salt a day.
  - **Cited:** Public Health England 2018 §Energy
  - **Passage:** 1046kJ 250kcal Fat Saturates Sugars Salt 3.0g 1.3g 34g 0.9g 15%38%7%4%13% LOW LOW HIGH MED *Free sugars - Any sugar added to food or drink products by the manufacturer, cook or consumer including those naturally found in honey, syrups and unsweetened fruit juice. Sugary drinks have no place in a chi…

### What does WHO recommend as a sodium limit for adults?

> The World Health Organization recommends that adults limit salt intake to less than 5 grams per day, which corresponds to about 2 grams of sodium per day.

- **Claim:** In adults, salt intake should be limited to less than 5 grams per day (2 grams per day sodium).
  - **Cited:** World Health Organization 2026 §Salt/sodium and potassium
  - **Passage:** foods (e.g. ready meals; processed meats such as bacon, ham and salami; cheese; and salty snacks) or from foods consumed frequently in large amounts (e.g. bread). Salt is also added to foods during cooking (e.g. bouillon, stock cubes, soy sauce and fish sauce) or at the point of consumption (e.g. ta…

### What are the five keys to safer food?

> The five keys to safer food are: keep clean; separate raw and cooked foods; cook thoroughly; keep food at safe temperatures; and use safe water and raw materials.

- **Claim:** The core messages of the Five Keys to Safer Food are: keep clean; separate raw and cooked; cook thoroughly; keep food at safe temperatures; and use safe water and raw materials.
  - **Cited:** World Health Organization 2006 §Five keys to safer food manual
  - **Passage:** Download (3.8 MB) Overview The core messages of the Five Keys to Safer Food are: keep clean; separate raw and cooked; cook thoroughly; keep food at safe temperatures; and use safe water and raw materials. The poster has been translated into more than 87 languages and is being used to spread …

