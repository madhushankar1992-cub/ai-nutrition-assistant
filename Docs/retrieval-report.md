# Retrieval Evaluation Report

Config `932717403c` · k=5 · Xenova/bge-small-en-v1.5
Chunking 500/900/80 · generated 2026-10-02T20:38:34.960Z

## Headline

| Metric | Result |
|---|---|
| `recall@5` (correct document **and** expected text) | **13/17 — 76.5%** |
| `document_recall@5` (correct document only) | 15/17 — 88.2% |
| False refusals on answerable questions | 0/17 |
| Adversarial suite | 8/8 passed |
| Claims produced for spot-check | 16 across 10 answers |

**Why two recall numbers.** `document_recall` says the right *document* came back;
`recall@k` says the specific passage carrying the answer did. A gap between them means
retrieval finds the right source but the wrong section — a chunking problem, not an
embedding one.

## Per question

| ID | Chunk hit | Rank | Doc hit | Docs in top-k | Top score |
|---|---|---|---|---|---|
| rq01-fsa-leftovers | yes | 1 | yes | 1 | 0.796 |
| rq02-fsa-fridge-temp | yes | 3 | yes | 1 | 0.722 |
| rq03-fsa-freezer-temp | yes | 1 | yes | 1 | 0.692 |
| rq04-fsa-cooling-time | yes | 1 | yes | 1 | 0.781 |
| rq05-fsa-defrost | yes | 1 | yes | 1 | 0.719 |
| rq06-who-fruit-veg | **no** | — | **no** | 2 | 0.675 |
| rq07-who-free-sugars | **no** | — | **no** | 3 | 0.601 |
| rq08-who-salt | yes | 3 | yes | 3 | 0.620 |
| rq09-who-sodium | yes | 1 | yes | 3 | 0.662 |
| rq10-who-five-keys | yes | 1 | yes | 2 | 0.885 |
| rq11-eatwell-saturated-fat | yes | 1 | yes | 2 | 0.673 |
| rq12-eatwell-five-a-day | yes | 1 | yes | 2 | 0.727 |
| rq13-dga-sodium | yes | 3 | yes | 3 | 0.679 |
| rq14-dga-protein-foods | yes | 1 | yes | 2 | 0.647 |
| rq15-efsa-fibre | **no** | — | yes | 1 | 0.733 |
| rq16-efsa-vitamin-c | **no** | — | yes | 1 | 0.727 |
| rq17-crossdoc-salt | yes | 1 | yes | 3 | 0.698 |

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

> The guidance says cooked leftovers should be eaten within 48 hours of being placed in the fridge.

- **Claim:** Eat leftovers within 48 hours or freeze them if you think this won’t be possible.
  - **Cited:** Food Standards Agency 2017 §Guidance
  - **Passage:** then has to work harder to lower the temperature. Don’t place hot or warm food in your fridge. Instead, cool cooked food at room temperature and place in the fridge within one to two hours. To cool food quickly, divide food into smaller portions in containers or freezer bags before putting in the f…
- **Claim:** Eat leftovers within 48 hours or freeze them if you think this won’t be possible.
  - **Cited:** Food Standards Agency 2017 §Guidance
  - **Passage:** cooled, and put in the fridge within two hours. Putting food in the fridge slows bacterial growth so it is safe to eat. Eat leftovers within 48 hours or freeze them if you think this won’t be possible. For more information see the ‘Using your leftovers’ section on our ‘ Cooking your food ’ page. 2.…

### What temperature should a domestic fridge be set to?

> The guidance recommends setting a domestic fridge to a temperature between 0 °C and 5 °C.

- **Claim:** Your fridge should be between 0 and 5°C.
  - **Cited:** Food Standards Agency 2017 §Guidance
  - **Passage:**  and freezing your food safely: your fridge should be between 0 and 5°C and your freezer should be around -18°C keep chilled food out of the fridge for the shortest time possible during preparation (a maximum of four hours) eat leftovers within two days or freeze if you think this won’t be possib…
- **Claim:** You should always store any food with a ‘use by’ date, as well as cooked dishes, salads and dairy products, in your fridge.
  - **Cited:** Food Standards Agency 2017 §Guidance
  - **Passage:** the fridge to change the power setting. Check the manufacturer’s instructions on how to do this correctly. You should always store any food with a ‘use by’ date, as well as cooked dishes, salads and dairy products, in your fridge. Follow storage instructions on packaging, including the best before …

### What temperature should a freezer be kept at?

> The guidance recommends keeping a domestic freezer at about –18 °C.

- **Claim:** your freezer should be around -18°C
  - **Cited:** Food Standards Agency 2017 §Guidance
  - **Passage:** for freezing. Here’s our top tips on freezing your food safely: your freezer should be around -18°C follow any freezing or defrosting instructions on the label you can freeze food right up until midnight on the ‘use by’ date printed on the label leftovers and homemade goods should be frozen as …
- **Claim:** The cold temperatures of a domestic freezer (-18°C) delay chemical reactions within foods
  - **Cited:** Food Standards Agency 2017 §FSA Explains: The Danger Zone
  - **Passage:** The cold temperatures of a domestic freezer (-18°C) delay chemical reactions within foods and put any bacteria that may be present on pause. The bacteria haven’t been killed, and they may be revived as the food defrosts. Defrost food in the fridge to prevent it sitting in between 8 - 63°C, which is…

### How quickly should cooked food be put in the fridge after cooking?

> Cooked food should be cooled at room temperature and placed in the refrigerator within one to two hours after cooking.

- **Claim:** Don’t place hot or warm food in your fridge. Instead, cool cooked food at room temperature and place in the fridge within one to two hours.
  - **Cited:** Food Standards Agency 2017 §Guidance
  - **Passage:** then has to work harder to lower the temperature. Don’t place hot or warm food in your fridge. Instead, cool cooked food at room temperature and place in the fridge within one to two hours. To cool food quickly, divide food into smaller portions in containers or freezer bags before putting in the f…
- **Claim:** Don’t place hot or warm food in your fridge. Instead, cool cooked food at room temperature and place in the fridge within one to two hours.
  - **Cited:** Food Standards Agency 2017 §Guidance
  - **Passage:** the fridge to change the power setting. Check the manufacturer’s instructions on how to do this correctly. You should always store any food with a ‘use by’ date, as well as cooked dishes, salads and dairy products, in your fridge. Follow storage instructions on packaging, including the best before …

### How long can defrosted food be kept before using it?

> Defrosted food should be used within 24 hours after it has been fully thawed.

- **Claim:** It’s also important to use food within 24 hours after it’s been fully defrosted – it will go bad in the same way as if it were fresh.
  - **Cited:** Food Standards Agency 2017 §FSA Explains: Freezer burn
  - **Passage:** including recipe ideas. 3. Defrosting Food You should defrost your food in the fridge so that it doesn’t get too warm, see our Danger Zone info below for why this is important. It’s also important to use food within 24 hours after it’s been fully defrosted – it will go bad in the same way as if it…
- **Claim:** It’s also important to use food within 24 hours after it’s been fully defrosted – it will go bad in the same way as if it were fresh.
  - **Cited:** Food Standards Agency 2017 §FSA Explains: Freezer burn
  - **Passage:** Freezer burn is when foods in the freezer are exposed to cold, dry air, which causes them to dehydrate and form ice crystals over time. This process affects the quality of the foods, rather than the safety. Freezer burn can be avoided by carefully packaging foods in the freezer and checking foods a…

### How many grams of fruit and vegetables should be eaten each day?

> Public Health England’s Eatwell Guide defines a portion of fruit or vegetables as 80 g and recommends eating at least five portions each day, which equals roughly 400 g of fruit and vegetables daily.

- **Claim:** A portion is 80 g; aim for at least five portions of fruit and veg each day.
  - **Cited:** Public Health England 2018 §BodyMassIndex.aspx
  - **Passage:** Choose foods high in fat, salt and sugar less often. 8 tips for eating well 1. Base your meals on starchy foods 2. Eat lots of fruit and veg 3. Eat more fish – including a portion of oily fish each week 4. Cut down on saturated fat and sugar 5. Eat less salt – no more than 6g a day for adults 6. Get…
- **Claim:** A portion is 80 g; aim to eat at least five portions of a variety of fruit and veg each day.
  - **Cited:** Public Health England 2018 §When should I use the Eatwell Guide?
  - **Passage:** You can use the Eatwell Guide to help you make healthier choices whenever you’re: • deciding what to eat • at home cooking • out shopping for groceries • eating out in a restaurant, cafe or canteen • choosing food on the go Aim to fill your trolley with a healthy balance of different types of food. …

### What proportion of energy should come from free sugars?

> Guidance recommends that free sugars should provide no more than 5% of total energy intake.

- **Claim:** Ideally, no more than 5% of the energy we consume should come from free sugars.
  - **Cited:** Public Health England 2018 §Sauce
  - **Passage:** C r i s p Remember that the portion sizes used on the label are suggestions and may not be the same as you actually consume. For example, some foods and drinks commonly consumed as single servings have the nutritional information presented per half pack. To find out more about food labelling you can…

### What is the recommended daily limit for salt intake?

> Guidance varies: one source advises adults should not exceed 6 g of salt per day, while another recommends keeping intake below 5 g per day to help prevent hypertension.

- **Claim:** Adults should eat no more than 6g of salt a day.
  - **Cited:** Public Health England 2018 §Energy
  - **Passage:** 1046kJ 250kcal Fat Saturates Sugars Salt 3.0g 1.3g 34g 0.9g 15%38%7%4%13% LOW LOW HIGH MED *Free sugars - Any sugar added to food or drink products by the manufacturer, cook or consumer including those naturally found in honey, syrups and unsweetened fruit juice. Sugary drinks have no place in a chi…
- **Claim:** Keeping salt intake to less than 5 g per day helps prevent hypertension and reduces the risk of heart disease and stroke in the adult population.
  - **Cited:** European Food Safety Authority 2017 §1.96 SD using a combined SD for growth and maintenance (Table 3).
  - **Passage:** More recently, other authorities have set DRVs for molybdenum and these are based on the maintenance of molybdenum homeostasis as measured in balance studies, taking into account molybdenum bioavailability from various food sources, or are based on observed molybdenum intakes with a mixed diet. Vari…

### What does WHO recommend as a sodium limit for adults?

> The WHO guideline passages provided do not specify a numeric sodium limit for adults.


### What are the five keys to safer food?

> The five keys to safer food are: keep clean; separate raw and cooked foods; cook thoroughly; keep food at safe temperatures; and use safe water and raw materials.

- **Claim:** The core messages of the Five Keys to Safer Food are: keep clean; separate raw and cooked; cook thoroughly; keep food at safe temperatures; and use safe water and raw materials.
  - **Cited:** World Health Organization 2006 §15 May 2006
  - **Passage:** | Manual Download (3.8 MB) Overview The core messages of the Five Keys to Safer Food are: keep clean; separate raw and cooked; cook thoroughly; keep food at safe temperatures; and use safe water and raw materials. The poster has been translated into more than 87 languages and is being used to spr…

