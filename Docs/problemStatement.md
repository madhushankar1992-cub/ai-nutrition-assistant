# AI Nutrition Assistant

You are tasked with building an AI-powered chatbot that answers questions about food, nutrition and food safety using a Large Language Model (LLM). The project is built in milestones. Milestone 1 uses the model's own knowledge with no retrieval layer, deliberately, so that unsupported claims and inconsistent answers are exposed and recorded rather than hidden. Milestone 2 puts a retrieval layer underneath it so every claim traces back to a published guidance document. Milestone 3 adds structured per-food nutrient data.

Each milestone keeps the interface, endpoints and response shape of the one before it. The work is additive: later milestones fill in fields and layers that earlier milestones deliberately left empty.

## Milestone Map

| Milestone | Theme | Source of truth for an answer | `claims[].source` |
|---|---|---|---|
| 1 | Prototype without retrieval | The model's own parametric knowledge | Always `null` |
| 2 | Dietary guidance RAG | Retrieved chunks from 5–7 official guidance documents | A real citation on every claim |
| 3 | Structured nutrient data | A structured food/nutrient database, alongside the Milestone 2 corpus | Citation, plus structured data provenance |

---

## Milestone 1: Prototype Without Retrieval

### Objective

Design and implement an application that:

- Accepts natural-language questions about food, nutrition, cooking and food safety.
- Generates concise, structured answers containing answer text and a list of factual claims.
- Includes a source field for every claim, set to `null` in Milestone 1.
- Enforces scope limits in code and records unreliable or inconsistent responses.
- Preserves the interface, endpoints and response structure for the future retrieval layer.

### System Workflow

#### 1. User Input and Chat Interface

- Build a message list, an input box and a sources panel beside the conversation.
- Allow follow-up questions and retain conversation history. Keep the sources panel empty in Milestone 1.

#### 2. Backend and Conversation Storage

- Create a chat endpoint that receives user messages, stores conversations and calls the model.
- Keep all model calls and API credentials on the server, never in the browser.

#### 3. Prompt Design and Response Generation

- Write a system prompt defining the assistant's role, answering style, answer length and excluded topics.
- Use the provider's structured-output mode. Return answer text and a claims list; each claim must contain claim text and a source field.
- Validate every response against the schema. Reject invalid output and require all source fields to remain null in Milestone 1.

#### 4. Scope Control

- Enforce restrictions in backend code as well as in the system prompt.
- Decline calorie or weight targets, recommendations about what anyone should weigh, and medical advice, including condition-specific diet recommendations.
- Refer users making these requests to a qualified professional. Apply the restrictions to rephrased, indirect and follow-up requests.

#### 5. Output Display

- Display the validated answer clearly in the conversation and retain its structured claims for evaluation.
- Build the sources panel now so Milestone 2 can populate it without changing the interface.

#### 6. Evaluation Dataset and Failure Log

- Prepare a fixed set of 10 questions covering nutrient requirements, food safety and storage, cooking methods, and questions without a clear answer. Use this as an evaluation dataset, not a knowledge source for the chatbot.
- Ask the same question three times and compare the substance, particularly numerical claims. Run all 10 questions and rerun the full set after every prompt change.
- For each response, record unsupported factual claims, numbers that shift between runs, cited sources that cannot be found, missed refusals and unhelpful hedging.
- Group failures by type and count them. Record observed failures without hardcoding question-specific fixes.

#### 7. Scope Testing and Deployment

- Test requests for a daily calorie target and advice on what someone with a specific condition should eat. Rephrase both, ask indirectly and repeat them after unrelated messages. The assistant must decline every time.
- Push the project to GitHub and deploy it at a public URL using Vercel or Railway.

#### 8. Preparation for Milestone 2

- Add retrieval in the next milestone and populate source fields with supporting citations while keeping the interface, endpoints and response structure unchanged.
- Run the same 10 questions again and compare the results with the Milestone 1 failure log.

### Suggested Tools

- **Frontend and backend:** Next.js, or React with FastAPI.
- **Model:** Anthropic or OpenAI API.
- **Storage:** Supabase, Postgres or SQLite.
- **Scaffolding:** Cursor or Anti-gravity.
- **Deployment:** Vercel or Railway.

### Expected Deliverables

- A live chatbot
- A GitHub repository
- A validated response schema
- A system prompt
- Code-enforced scope controls
- The fixed 10-question evaluation dataset
- A completed failure log with grouped counts

### What Milestone 1 Delivered — the Baseline Milestone 2 Builds On

This is the as-built state Milestone 2 starts from. It is recorded here so the Milestone 2 requirements below can name exactly what changes and what must not.

- **One Next.js App Router codebase**, with a single backend route (`app/api/chat/route.ts`, `POST` + `DELETE`). There is no separate backend service, and Milestone 2 does not introduce one.
- **A frozen response shape**: `{ conversationId, answer, claims[] }`. Milestone 2 widens what a claim's `source` can hold; it does not rename or restructure the envelope.
- **Zod schemas as the single source of truth** (`lib/schema.ts`), converted to the LLM provider's JSON-schema structured-output format and reused to validate both the incoming request and the parsed model response.
- **A code-level scope guard** (`lib/scopeGuard.ts`): regex-based, not a classifier and not prompt-reliant, run before the model call against recent conversation history plus the new message, so rephrased, indirect and split-across-turns restricted requests are still caught. A second pass scans the generated answer. Milestone 2 keeps this layer as-is and adds to it, rather than replacing it.
- **A sources panel with an unreachable populated branch** (`components/SourcesPanel.tsx`): the "no source yet" rendering is live, and the branch that renders a real citation was written in Milestone 1 and has never executed.
- **A fixed 10-question evaluation dataset** (`data/eval-questions.json`), spanning four categories: `nutrient_requirements`, `food_safety_storage`, `cooking_methods`, `no_clear_answer`.
- **A failure log with grouped counts** (`Docs/failure-log.md`), produced by `scripts/evaluate.ts` running each question three times. The recorded Milestone 1 baseline is **4 instances of `numeric_drift`** — questions whose numeric claims changed between identical runs — across protein requirements, egg storage, cooked-rice storage and blanching time. The log's category vocabulary is `unsupported_claim`, `numeric_drift`, `broken_source`, `missed_refusal`, `unhelpful_hedging`, `invalid_schema`.

---

## Milestone 2: Dietary Guidance RAG Chatbot

### Objective

Put a retrieval layer under the Milestone 1 chatbot so it answers only from official public dietary guidance documents. Every claim must carry a citation. When the guidance doesn't cover a question, the assistant must say so, and name what it searched.

### Where This Goes

- Milestone 1 delivered a frontend, a backend and a response schema with an empty `source` field on every claim. Milestone 2 fills that field in — the interface doesn't change, but an answer now has to come from a document you can point at.
- In the final project this becomes the service that answers "is this a reasonable way to eat" and "how long can I keep this in the fridge".

### The Problem

- The Milestone 1 failure log already has the symptoms written down: numbers that move between runs, authorities cited that never said it, claims with nothing behind them. The 4 logged `numeric_drift` instances are the measurable version of the problem — the same question asked three times produced three different sets of numbers, with nothing to adjudicate between them.
- Health authorities publish long, careful, boring PDFs on exactly this topic — no API, just written prose, and almost nobody reads them. That gap is what RAG is for.
- Nutrient numbers for individual foods are different data and don't belong in this corpus. Those come from a structured database in Milestone 3.

### Scope: In and Out

**In scope for the corpus:**

- Population-level dietary guidance: recommended intakes for adults, food-group advice, dietary patterns.
- Food safety and hygiene guidance: storage times, holding and cooking temperatures, reheating and cooling rules, cross-contamination.
- Cooking and food-handling guidance where an authority has published prose on it.

**Out of the corpus, by design:**

- Per-food nutrient composition tables ("how much iron is in 100g of spinach"). This is structured data with its own retrieval story, and belongs to Milestone 3. Pulling it into a prose corpus produces exactly the kind of number-shaped claim that chunking damages and citation cannot repair.
- Any document available behind a clean API. If it has an API, it is structured data, and this is not where it goes.
- Journal articles, blog posts, news coverage, commercial or brand material, and secondary summaries of guidance. Only the authority's own published guidance counts.

**Out of scope for the assistant entirely** (unchanged from Milestone 1, enforced in code): calorie targets, weight targets, what anyone should weigh, medical advice, condition-specific diet recommendations.

### System Workflow

#### 1. Corpus

Gather 5 to 7 public guidance documents from recognised authorities. National nutrition institutes, food safety regulators and international health bodies all work. Written prose only — anything with a clean API behind it doesn't belong here.

**Requirements:**

- **5 to 7 documents.** Not fewer, not more. The ceiling is part of the exercise: a small corpus makes "the guidance doesn't cover this" a frequent, real answer rather than an edge case.
- **Each document must be publicly retrievable** at a stable URL, so a citation can be opened and checked by a reader.
- **Record for every document**, and keep it queryable alongside the chunks: document name, publisher, publication year, source URL, and the date it was retrieved.
- **Cover more than one authority.** A corpus of documents from a single publisher cannot exercise the cross-document and disagreement requirements below.
- **Deliberately include at least one overlap** — a topic where two documents from different publishers both have something to say — and know which topic that is before building the question bank.
- **Record the corpus boundary**: write down what the corpus does *not* cover (for example, if every document addresses adults, record that children's requirements are absent). The not-in-corpus refusal and the near-miss test below both depend on this being explicit.

**Authority test** — a document qualifies if it is published by a national nutrition institute, a national or regional food safety regulator, a health ministry or equivalent government health body, or an international health organisation, *and* the document is that body's own guidance rather than a summary of someone else's.

##### Candidate Documents — Public URLs

Every URL below was checked on **2026-10-02**, and where a document could be downloaded it was opened and its contents read — title, publisher, year, page count and sample text — rather than merely confirming the link resolved. The status column reports what that check actually found, because a citation the reader cannot open, or that names the wrong edition, is precisely the failure this milestone exists to fix.

Pick 5–7. The list is deliberately longer than the ceiling so there is room to drop the ones whose status below makes them unusable.

| # | Document | Publisher | Year | URL | What the check found on 2026-10-02 |
|---|---|---|---|---|---|
| 1 | Healthy diet (Fact sheet No. 394) | World Health Organization | 2018 | https://www.who.int/publications/m/item/healthy-diet-factsheet394 | **Verified, contents read.** Published 30 Aug 2018. Carries the headline numbers directly: ≥400 g fruit and vegetables daily, total fat <30% of energy, saturated fat <10%, trans fat <1%, free sugars <10% (ideally <5%), salt <5 g/day. Short, dense, entirely population-level — the single best-value document in this list |
| 2 | Saturated fatty acid and trans-fatty acid intake for adults and children: WHO guideline | World Health Organization | 2023 | https://www.who.int/publications/i/item/9789240073630 | **Verified.** Landing page confirmed, published 17 Jul 2023, ISBN 978-92-4-007363-0. The guideline itself is a ~1.2 MB PDF linked from that page; the landing page carries the abstract but not the numeric thresholds |
| 3 | Guideline: Sodium intake for adults and children | World Health Organization | 2012 | https://www.who.int/publications-detail-redirect/9789241504836 | **Verified.** Published 25 Dec 2012, ISBN 978-92-4-150483-6, WHO reference WHO/NMH/NHD/13.2, 403 kB PDF downloadable from the page. An open mirror also responds: `https://iris.who.int/bitstream/handle/10665/77985/9789241504836_eng.pdf`. The <2,000 mg/day adult figure is widely reported but was **not** read out of the document itself — confirm it in the PDF before citing it |
| 4 | **Dietary Guidelines for Americans, 2025–2030 (10th edition)** | U.S. Departments of Agriculture and Health and Human Services | **2026** | https://cdn.realfood.gov/DGA.pdf | **Verified, contents read.** 3.3 MB, **10 pages**, PDF title metadata `Dietary Guidelines for Americans, 2025–2030`, created 6 Jan 2026. Served from `realfood.gov`; landing page https://odphp.health.gov/our-work/nutrition-physical-activity/dietary-guidelines/current-dietary-guidelines. **Read the warning below before including this one** |
| 5 | Cold Food Storage Charts | FoodSafety.gov (U.S. Dept. of Health and Human Services) | current | https://www.foodsafety.gov/food-safety-charts/cold-food-storage-charts | **Hard-blocked (HTTP 403), browser user-agent did not help.** The page is real and public in a browser; the server rejects programmatic clients outright. Must be saved by hand. Holds the refrigerator/freezer storage tables that answer the egg- and leftover-storage questions in the Milestone 1 dataset |
| 6 | Safe Minimum Internal Temperature Chart | USDA Food Safety and Inspection Service | current | https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/safe-temperature-chart | **Hard-blocked (HTTP 403), browser user-agent did not help.** Same situation as #5; the Spanish-language mirror (`/es/node/3293`) is blocked too. Covers the chicken-temperature question in the Milestone 1 dataset |
| 7 | The Eatwell Guide (booklet) | Public Health England | 2018 | https://assets.publishing.service.gov.uk/media/5ba8a50540f0b605084c9501/Eatwell_Guide_booklet_2018v4.pdf | **Verified, contents read.** 7.5 MB, **12 pages**, PDF title metadata `The Eatwell Guide`, created 21 Sep 2018, carries the Public Health England strapline "Protecting and improving the nation's health". **5,166 words at 430 words/page.** Page 1 (the plate) is artwork with scattered food-name labels and should be dropped; pages 2–12 are ordinary prose with quotable guidance — *"no more than 5% of the energy we consume should come from free sugars"*, *"no more than 30g saturated fat a day"*. Landing page: https://www.gov.uk/government/publications/the-eatwell-guide |
| 8 | Dietary Reference Values for nutrients: Summary report | European Food Safety Authority | 2017 | https://www.efsa.europa.eu/sites/default/files/2017_09_DRVs_summary_report.pdf | **Verified, contents read.** 2.7 MB, **92 pages**, title `Dietary Reference Values for nutrients Summary report`, approved 4 Dec 2017, DOI `10.2903/sp.efsa.2017.e15121`. Covers water, fats, carbohydrates, fibre, protein, energy, 14 vitamins and 13 minerals. The document states its own suggested citation, and permits reproduction provided the source is acknowledged. The densest reference-value source here. Publication page: https://www.efsa.europa.eu/en/supporting/pub/e15121 — **note that this landing page returns HTTP 403 to automated requests while the PDF above returns 200**, so for EFSA the PDF is the fetchable address and the landing page is browser-only |
| 9 | How to chill, freeze and defrost food safely | Food Standards Agency (UK) | 2017 | https://www.gov.uk/government/publications/how-to-chill-freeze-and-defrost-food-safely | **Verified, full guidance text read.** Published 18 Dec 2017. Sections: Chilling food · Freezing Food · Defrosting Food · How to stock your fridge. Verified content: fridge **0–5 °C**, checked weekly; cooked food cooled and refrigerated **within 1–2 hours**; chilled food out of the fridge **max 4 hours** during prep; **leftovers eaten within 48 hours** or frozen; freezer **around −18 °C**; freeze up to midnight on the use-by date; defrost in the fridge and **use within 24 hours** once defrosted; cooked food refrozen may be **reheated only once**. Note the older `food.gov.uk/safety-hygiene/chilling` address **301-redirects here** |
| 10 | Dietary Guidelines for Indians — A Manual, 2nd edition | ICMR–National Institute of Nutrition, Hyderabad | **2011** | https://www.nin.res.in/downloads/DietaryGuidelinesforNINwebsite.pdf | **Verified, contents read — but it is the superseded edition.** 5.0 MB, **139 pages**, first published 1998, second edition 2011, file created 2012. **This is not the 2024 revision.** Note the document's own terms: free download for personal use and non-profit dissemination, no commercial reproduction, and usage is to be intimated to the Director, NIN in advance |
| — | Dietary Guidelines for Indians, 2024 revised edition | ICMR–National Institute of Nutrition, Hyderabad | 2024 | *no working direct URL found* | **Not retrievable programmatically.** `nin.res.in` serves it only through a password-locked pdf.js viewer, and the deep path search engines index (`/dietaryguidelines/pdfjs/locale/DGI24thJune2024fin.pdf`) returns HTTP 404 to a direct request. The `main.icmr.nic.in` path that appears in search results does not resolve in DNS at all. Obtain it by hand or leave it out |
| 11 | Five keys to safer food manual | World Health Organization | 2006 | https://www.who.int/publications/i/item/9789241594639 | **Verified (page).** Published 15 May 2006, 28 pages, ISBN 978-92-4-159463-9. The five core messages — keep clean; separate raw and cooked; cook thoroughly; keep food at safe temperatures; use safe water and raw materials — are prose guidance from an international health body, and this is **the strongest non-blocked substitute for the blocked US food-safety charts**. The `iris.who.int` bitstream path returns an HTML landing page rather than the PDF directly, so resolve the actual file from the publication page |
| 12 | Issuing Temperature Guidance to Consumers on the Cooking and Storage of Food | safefood — the Food Safety Promotion Board (Ireland) | 2004 | https://www.safefood.net/getmedia/38eb7981-237a-4919-9a18-9373013363fe/IssuingTemperatureGuidanceToConsumersOnTheCookingAndStorageOfFood.pdf | **Verified, contents read.** 213 kB, **14 pages**, dated May 2004, cleanly machine-readable. Exactly on-topic for cooking and storage temperatures — but note the cover states "For use by Food Safety Advisors", so it is guidance *about issuing* consumer advice rather than consumer advice itself, and it is 22 years old |
| 13 | Food Safety: Temperature control of potentially hazardous foods | Food Standards Australia New Zealand | 2002 | https://www.foodstandards.gov.au/sites/default/files/publications/Documents/FSTemp_control_Edition_for_printing.pdf | **Verified, contents read.** 161 kB, **23 pages**, first published April 2002, ISBN 0 642 34585 6. Qualifying regulator and clean text, but it is guidance on the *legal* temperature-control requirements of Standard 3.2.2 for food businesses, not domestic guidance — and its copyright notice permits reproduction only for personal or in-organisation use, with no alteration. Weigh that before ingesting it |

##### Content Research — What Is Actually Inside These Documents

URL status and title metadata are not enough to plan a corpus. Every downloadable candidate was fully text-extracted on 2026-10-02 and measured. These numbers drive the chunking, `k` and token-budget decisions.

| Document | Pages | **Words** | Words/page | Extraction quality | Notes from the text |
|---|---|---|---|---|---|
| **DGA 2025–2030** (USDA/HHS) | 10 | **2,704** | 270 | Clean | **Far smaller than expected.** Section headings are "Prioritize Protein Foods at Every Meal", "Consume Dairy", "Eat the Right Amount for You", "Gut Health", "Eat Vegetables & Fruits Throughout the Day", "Incorporate Healthy Fats", "Focus on Whole Grains", "Limit Highly Processed Foods, Added Sugars…". Verified numeric guidance: **"less than 2,300 mg per day of sodium"** |
| **EFSA DRV Summary** | 92 | **48,717** | 529 | Clean, well structured | **By far the densest source** — a real table of contents, a list of tables, and **133 numeric statements**. Sections include Total and glycaemic carbohydrates, Dietary Fibre, Glycaemic index and load, Total fat |
| **Eatwell Guide** | 12 | **5,166** | 430 | **Mixed — page 1 only is artwork** | See the correction below |
| **Brazil Dietary Guidelines** | 152 | **30,459** | 200 | Clean | Long-form prose, organised as numbered chapters and "golden rules" |
| **ICMR-NIN (2011)** | 139 | **33,106** | 238 | Clean | Full manual with per-guideline chapters |
| **safefood (Ireland)** | 14 | **6,085** | 434 | Clean | Numbered sections: 1.1 Background, 1.2 Terms of reference, 1.3 Scope, 2.1 Transport and storage |
| **FSANZ** | 23 | **6,930** | 301 | Clean | Guidance on Standard 3.2.2 temperature-control requirements |

**Corpus-size consequence.** The recommended seven total roughly **95,000–135,000 words**, which at a 500-token chunk target is on the order of **300–400 chunks**. That is small. It confirms two decisions: exact vector search is correct (no approximate index needed), and the corpus will frequently *not* cover a question — which makes the not-in-corpus refusal a mainline path, not an edge case.

**Volume is wildly uneven.** EFSA alone (48,717 words) is roughly **18× the entire current US dietary guidance** (2,704 words). Under a single global `k`, the US document can be crowded out of every result despite being current official guidance. This is the strongest argument for reporting recall per document.

> **Correction to an earlier assessment — the Eatwell Guide.** An initial look at page 1 suggested the whole document extracts as unusable word-salad. **Full extraction shows that is wrong.** Only page 1 — the plate diagram — is artwork with scattered food-name labels. Pages 2–12 contain ordinary prose at 430 words/page, including directly quotable guidance such as *"Ideally, no more than 5% of the energy we consume should come from free sugars"* and *"no more than 30g saturated fat a day"*. The document is usable; only its first page should be dropped. Judging a PDF from its cover page is itself the mistake worth recording.

> **⚠ The scope conflict is broader than first reported.** The calorie- and body-weight-target problem was initially attributed to the DGA alone. Full text extraction shows **EFSA's DRV Summary contains the same class of content**: *"0.8 to 1.25 g/kg body weight per day for adults"* for protein, plus energy figures in kcal/day (for example an additional ~500 kcal/day in the third trimester of pregnancy). EFSA is the **#2 recommended document and the densest source in the corpus** — so the restricted-content policy cannot be a special case bolted onto one document. It must be a general ingestion-time rule applied across the whole corpus. See the warning on candidate #4 below, which now applies to #2 as well.

##### Extended Candidate Pool — Group B: Further WHO Guidelines

Single-nutrient WHO guidelines. Each was confirmed by reading the page's own title metadata, not by assuming the ISBN. Useful because a single-nutrient guideline is the cleanest way to exercise **single-document filtered retrieval**.

| # | Document | Publisher | Year | URL | Check result |
|---|---|---|---|---|---|
| 14 | Guideline: sugars intake for adults and children | WHO | 2015 | https://www.who.int/publications/i/item/9789241549028 | **200, title verified.** The source of the "<10% of energy, ideally <5%" free-sugars recommendation |
| 15 | Guideline: potassium intake for adults and children | WHO | 2012 | https://www.who.int/publications/i/item/9789241504829 | **200, title verified.** Companion to the sodium guideline; the two are designed to be read together |
| 16 | Total fat intake for the prevention of unhealthy weight gain in adults and children: WHO guideline | WHO | 2023 | https://www.who.int/publications/i/item/9789240073654 | **200, title verified.** Part of WHO's July 2023 fats-and-carbohydrates update |
| 17 | Carbohydrate intake for adults and children: WHO guideline | WHO | 2023 | https://www.who.int/publications/i/item/9789240073593 | **200, title verified.** Same 2023 update |
| 18 | Use of non-sugar sweeteners: WHO guideline | WHO | 2023 | https://www.who.int/publications/i/item/9789240073616 | **200, title verified.** Narrow topic — a good not-quite-covered probe for questions about sweeteners generally |
| 19 | Diet, nutrition and the prevention of chronic diseases (WHO Technical Report Series 916) | WHO / FAO | 2003 | https://iris.who.int/handle/10665/42665 | **200.** WHO's institutional repository (IRIS) record. Long-form and older, but the foundational joint WHO/FAO expert consultation |
| 20 | Guideline: sodium intake — open repository mirror | WHO | 2012 | https://iris.who.int/bitstream/handle/10665/77985/9789241504836_eng.pdf | **200.** IRIS mirror of candidate #3. Useful because IRIS is friendlier to programmatic access than the main who.int site |

##### Extended Candidate Pool — Group C: National Dietary Guidance

| # | Document | Publisher | Year | URL | Check result |
|---|---|---|---|---|---|
| 21 | Dietary Guidelines for the Brazilian Population | Ministry of Health of Brazil, Secretariat of Health Care | 2015 | https://bvsms.saude.gov.br/bvs/publicacoes/dietary_guidelines_brazilian_population.pdf | **200, contents read.** 7.3 MB, **152 pages**, official English edition, PDF author metadata names the Ministry of Health of Brazil. **One of the strongest additions in this list**: it is internationally influential, entirely prose, almost entirely population-level, and notably light on numeric targets — which makes it a low-risk document for the scope guard |
| 22 | Canada's Food Guide | Health Canada | current | https://food-guide.canada.ca/en/ | **200 after redirect** — the English path lands on a redirect notice, so resolve and record the final canonical URL before citing it |
| 23 | Current Dietary Guidelines (landing page for candidate #4) | ODPHP / U.S. Dept. of Health and Human Services | 2026 | https://odphp.health.gov/our-work/nutrition-physical-activity/dietary-guidelines/current-dietary-guidelines | **200.** The reader-facing landing page for the 2025–2030 edition; pair it with the `cdn.realfood.gov` PDF, which is the fetchable address |
| 24 | The Eatwell Guide (landing page for candidate #7) | UK Government / Public Health England | 2018 | https://www.gov.uk/government/publications/the-eatwell-guide | **200.** Stable landing page; prefer this as the citation URL over the `assets.publishing.service.gov.uk` asset path, which carries a build hash |

##### Extended Candidate Pool — Group D: Scientific Advisory Committees

Expert advisory reports. Denser and more technical than consumer guidance, and valuable precisely because they state uncertainty — useful for the `no_clear_answer` question category.

| # | Document | Publisher | Year | URL | Check result |
|---|---|---|---|---|---|
| 25 | SACN reports and position statements (collection) | Scientific Advisory Committee on Nutrition (UK) | ongoing | https://www.gov.uk/government/collections/sacn-reports-and-position-statements | **200.** An index page, not a document — use it to select a specific report, do not ingest the index itself |
| 26 | SACN Salt and Health report | Scientific Advisory Committee on Nutrition (UK) | 2003 | https://www.gov.uk/government/publications/sacn-salt-and-health-report | **200.** The UK's underlying evidence basis for salt targets — a third framing to set against WHO's <5 g and the US sodium figures |
| 27 | SACN Carbohydrates and Health report | Scientific Advisory Committee on Nutrition (UK) | 2015 | https://www.gov.uk/government/publications/sacn-carbohydrates-and-health-report | **200.** Source of the UK free-sugars and fibre recommendations |

##### Extended Candidate Pool — Group E: Food Safety Regulators

This group matters disproportionately: **three of the ten Milestone 1 evaluation questions are food safety**, and both US food-safety sources are hard-blocked. These are the non-blocked alternatives.

| # | Document / resource | Publisher | Year | URL | Check result |
|---|---|---|---|---|---|
| 28 | Preventing foodborne illness | Food Standards Australia New Zealand | current | https://www.foodstandards.gov.au/consumer/safety | **200, title verified** as "Preventing foodborne illness \| Food Standards Australia New Zealand". Consumer-facing, unlike candidate #13 which targets businesses — the better FSANZ choice |
| 29 | Food safety for consumers | Canadian Food Inspection Agency | current | https://inspection.canada.ca/en/food-safety-consumers | **200, title verified** as "Food safety for consumers". A fourth national regulator, consumer-facing |
| 30 | Consumer Zone — Centre for Food Safety | Centre for Food Safety, Hong Kong SAR | current | https://www.cfs.gov.hk/english/consumer_zone/consumer_zone.html | **200**, site title "Safe Food For All". Adds a non-Western regulator, which widens the disagreement surface on storage times |
| 31 | Food safety at home | Ministry for Primary Industries, New Zealand | current | https://www.mpi.govt.nz/food-safety-home/ | **200** (page returns an empty `<title>`, so confirm the document title by eye before citing) |
| 32 | Food Safety Authority of Ireland | FSAI | current | https://www.fsai.ie/ | **200.** Root site; navigate to a specific guidance note rather than ingesting the homepage |
| 33 | Codex Alimentarius (FAO/WHO food standards programme) | FAO / WHO | ongoing | https://www.fao.org/fao-who-codexalimentarius/en/ | **200.** The international reference standard for food hygiene. **Caveat:** the direct standards-PDF proxy path (`CXC 1-1969`, General Principles of Food Hygiene) returns 403, so the PDF must be retrieved through the site by hand |

##### Checked and Rejected — with the reason

Recording these matters as much as the accepted list: each was reachable, and each fails a specific requirement.

| Candidate | URL | Why rejected |
|---|---|---|
| Harvard T.H. Chan Nutrition Source | https://www.hsph.harvard.edu/nutritionsource/ | **200, but fails the authority test.** A university public-health department is not a national nutrition institute, regulator, health ministry or international health body. Excellent content, wrong class of publisher |
| Nutrition.gov | https://www.nutrition.gov/ | **200, but it is a portal**, not an authority's own guidance. It aggregates and links to the documents already in this list; ingesting it would mean citing a signpost |
| NCBI Bookshelf | https://www.ncbi.nlm.nih.gov/books/NBK545442/ | **Blocked by reCAPTCHA** ("Checking your browser"). Not programmatically retrievable, and the hosted works are generally secondary reproductions |
| Nordic Nutrition Recommendations 2023 | https://pub.norden.org/nord2023-003/ | **403.** A genuinely strong document (a major 2023 multi-country reference) that could not be fetched. Worth acquiring manually if a recent reference-values source is wanted |
| Australian Dietary Guidelines (NHMRC) | `eatforhealth.gov.au`, `health.gov.au` | **Connection timeout (no HTTP response at all)** from this network on 2026-10-02, across three separate paths. Distinct from a 403 — retry before concluding it is unavailable |
| EFSA publication landing page | https://www.efsa.europa.eu/en/supporting/pub/e15121 | **403**, while the PDF at the same domain returns 200. Keep as the human-facing citation URL, fetch the PDF |
| FSSAI FSMS guidance documents | https://www.fssai.gov.in/cms/guidance-document.php | **200, wrong document class** — HACCP and compliance manuals for food businesses, not consumer dietary or domestic food-safety guidance |

##### Recommended Minimum Corpus — 7 Documents

Of the 13 candidates, these 7 are the defensible minimum: every one was fetched successfully on 2026-10-02, four had their contents read directly, they span five publishers across three continents, and together they cover all four Milestone 1 question categories.

| Pick | Document | Publisher | Year | Why it earns a slot |
|---|---|---|---|---|
| 1 | Healthy diet (Fact sheet 394) | WHO | 2018 | Highest density of population-level numbers per page in the whole list; covers fruit/veg, fats, sugars and salt in one short document |
| 2 | Dietary Reference Values for nutrients: Summary report | EFSA | 2017 | 92 pages of actual reference values across 14 vitamins and 13 minerals — the backbone for the `nutrient_requirements` questions, and it permits reproduction with acknowledgement |
| 3 | Dietary Guidelines for Americans, 2025–2030 | USDA / HHS | 2026 | Current official US guidance. Include it *with* the scope mitigation below, not without |
| 4 | The Eatwell Guide (booklet) | Public Health England | 2018 | A second national dietary-pattern document to set against #3, and the source of the "5 a day" framing that contrasts with WHO's 400 g |
| 5 | Five keys to safer food manual | WHO | 2006 | Covers cooking-thoroughly and safe-temperature guidance as prose; the usable replacement for the blocked USDA/FoodSafety.gov charts |
| 6 | How to chill, freeze and defrost food safely | Food Standards Agency (UK) | 2017 | Domestic chilling, freezing and defrosting rules — directly answers the storage questions, and supplies the disagreement partner described below |
| 7 | Guideline: Sodium intake for adults and children | WHO | 2012 | A single-nutrient guideline, which exercises single-document filtered retrieval, and disagrees in *units* with #3 and #4 |

Three publishers (WHO, EFSA, PHE/FSA, USDA-HHS) and two document classes (dietary guidance and food safety) are represented, which is what makes the cross-document and single-document-filter requirements testable. Candidates 10, 12 and 13 are reasonable substitutes if one of the above has to be dropped; candidates 5 and 6 of the main table are the ones to add if manual download is acceptable.

**Two traps this check uncovered — both are exactly the failure mode this milestone targets:**

1. **The US dietary guidelines changed edition.** The widely-cited *Dietary Guidelines for Americans, 2020–2025* (9th edition) has been superseded by the **2025–2030 10th edition, published January 2026**. Citing the 2020–2025 edition as current guidance would be a factually wrong citation that still opens cleanly in a browser — the hardest kind to catch. The old PDF URL is additionally 403-blocked. Use #4, and record the year as 2026.
2. **The Indian guidelines are a year trap.** The document that actually downloads from `nin.res.in` is the **2011** manual; the 2024 revision is locked behind a viewer. Citing the downloadable file as "ICMR-NIN 2024" would fabricate a citation while pointing at a real, authoritative, openable PDF — a fabricated citation with a working link. If the 2024 edition cannot be obtained by hand, either cite the 2011 edition honestly as 2011, or leave India out of the corpus.

> **⚠ Scope-conflict warning on #4 (Dietary Guidelines for Americans, 2025–2030).** Reading this document revealed that it states intake targets in exactly the forms this project refuses to produce: **"1.2–1.6 grams of protein per kilogram of body weight per day"**, **"3 servings per day as part of a 2,000-calorie dietary pattern"**, and guidance that begins "The calories you need depend on your…". Retrieved chunks from this document will therefore contain per-body-weight and calorie-target content. This is not a reason to exclude it — it is the current official US guidance — but it means the out-of-scope guard and the retrieval layer are now in direct tension: the corpus itself contains the restricted material. Decide and record how this is handled (filter such passages at ingestion, exclude those sections, or rely on the existing pre- and post-call guards), and add a test that asks for a protein target and confirms the assistant still refuses even though a retrievable chunk would answer it.

**Deliberately excluded, and why:**

- **FSSAI Food Safety Management System guidance documents** (https://www.fssai.gov.in/cms/guidance-document.php) — sector-specific HACCP and compliance manuals written for food business operators, not consumer dietary or domestic food-safety guidance. They would retrieve confidently against questions about home storage and answer them from a commercial-compliance frame. Qualifying authority, wrong document class.
- **Any nutrient-composition table** ("iron per 100 g"), from any publisher. Structured data, Milestone 3.
- **News coverage and institutional summaries** of the documents above (`nutritionconnect.org`, press reports on the ICMR release, university-extension reproductions of the USDA charts). These dominated the search results for every query run above, and are the easiest way to end up citing a secondary source as though it were the authority.

**Ingestion notes carried forward from this check:**

- **HTTP 403 does not mean unavailable, and a browser user-agent does not always fix it.** Three US government URLs (#4's superseded predecessor, #5, #6) refused programmatic requests even with a full Chrome user-agent string. Those documents must be saved manually from a browser and committed to the repo. Budget for this; do not discover it mid-ingest.
- **Verify the edition, not just the link.** Two of eleven candidates point at a superseded edition while returning HTTP 200. Record the year from inside the document — PDF title metadata and the copyright page — not from the URL or the page that linked it.
- **Page counts vary by two orders of magnitude** across this list: 10 pages (#4) against 139 (#10) and 92 (#8). A fixed `k` will therefore pull a very uneven share of each document, and a short document can be crowded out entirely by a long one. Weight or filter accordingly, and report hit rate per document so this is visible.
- **Judge extraction on the whole document, not the first page.** The Eatwell Guide's page 1 is artwork and extracts as a word-salad of food names; pages 2–12 are clean prose at 430 words/page. A words-per-page gate computed over the whole file would have *passed* this document while still leaving one unusable page in the index. The right gate is **per page**, dropping bad pages, not per document.
- **Measure word counts, not page counts.** Page count is a poor proxy for content: the DGA 2025–2030 has 10 pages and 2,704 words (270/page), while EFSA has 92 pages and 48,717 words (529/page) — a **18× difference in actual content** from a 9× difference in pages. Chunk counts and retrieval share follow words, not pages.
- **Prefer landing pages over deep file paths for the citation URL** where both exist. Deep asset paths carry build hashes and get rotated; a landing page is what stays openable for a reader clicking a citation years later. **One exception found in practice:** EFSA's publication page is bot-blocked (403) while its PDF is not, so ingestion and citation may need different URLs for the same document. Store both — a `fileUrl` for fetching and a `url` for the reader.

**URL health check, 2026-10-02.** All **39 unique URLs** in this document were checked with a real browser user-agent and redirects followed:

| Result | Count | Which |
|---|---|---|
| **HTTP 200** | **35** | Everything not listed below |
| HTTP 403 (bot policy) | 4 | FoodSafety.gov cold-storage charts; USDA FSIS temperature chart; the EFSA publication landing page (its PDF returns 200); Nordic Nutrition Recommendations 2023 |
| HTTP 404 / dead | **0** | — |

**No URL in this document is dead.** Every failure is a deliberate bot policy at the publisher's end, and all four are reachable in a browser — so each is an acquire-by-hand item, not a broken citation. Two further points worth carrying forward:

- **Timeouts are not 403s.** The Australian Dietary Guidelines (`eatforhealth.gov.au`, `health.gov.au`) returned *no HTTP response at all* across three paths — a different failure from a refusal, and one that may be transient or network-specific. Retry before concluding the document is unavailable.
- **A 200 does not mean a document.** NCBI Bookshelf returns 200 while serving a reCAPTCHA page, and several entries above are index or portal pages rather than documents. Status code is a liveness check, not a content check — which is why every accepted candidate above also had its title, year or contents inspected.

Re-run this check at ingestion and record the result as each document's retrieval date.

##### What This Candidate List Implies for the Tests

- **The cross-document overlap is already present and real.** FoodSafety.gov (#5) and the UK FSA (#9) both cover storing cooked leftovers, and they do not agree.

  | Publisher | Leftovers kept for | Cooling after cooking | Fridge temperature |
  |---|---|---|---|
  | **FSA (UK)** — *read from the source document* | **within 48 hours** | within 1–2 hours | 0–5 °C |
  | **FoodSafety.gov (US)** — *see caveat* | **3–4 days** refrigerated | — | — |

  A genuine two-publisher disagreement on the exact question (`q5-safety-leftovers`) that produced numeric drift in Milestone 1 — unsurprising, since the model was averaging two genuinely different regimes with nothing to adjudicate between them. It is both the natural cross-document test case and the clearest demonstration of why blending sources into one claim about what "the guidelines say" is wrong. Neither number is the answer; both, attributed, are.

  **Caveat on the US figure, stated because this document is about citation honesty:** the FSA numbers were read directly from the FSA guidance text. The US "3–4 days" figure was **not** — FoodSafety.gov is 403-blocked, so that number comes from a search engine's rendering of the page and is a *secondary* source. Confirm it against the document itself once acquired by hand. Treating a search snippet as a verified primary citation is exactly the failure this milestone exists to prevent.
- **Salt and saturated fat give secondary overlaps.** WHO (#1) frames salt as <5 g/day while the US guidance works in sodium and milligrams; WHO (#2) sets saturated fat at <10% of energy while EFSA (#8) frames it as "as low as possible" rather than a percentage ceiling. Same topic, three publishers, different units and different framings — all legitimate, none reconcilable into a single claim.
- **The children's near-miss test needs a different boundary.** WHO's sodium guideline (#3) explicitly covers ages 2–15, and the US guidelines address life stages from birth onward, so with either in the corpus children's requirements are *not* absent and the suggested near-miss test stops being a near miss. Choose a different out-of-corpus boundary — clinical or therapeutic diets, pregnancy-specific requirements, or a cuisine or food category no document in the final corpus addresses — and record it as the corpus boundary.
- **Build the question bank against the documents actually ingested, after ingestion.** Two candidates here turned out to be the wrong edition and three could not be fetched at all. A question bank written against the intended corpus rather than the real one measures a corpus that does not exist.

#### 2. Chunking

Every chunk carries the document name, publisher, year and section heading. These documents are full of tables and numbered recommendations that fixed-size chunking will cut in half.

**Requirements:**

- **Every chunk carries its provenance**: document name, publisher, year, section heading, and a page or locator where the format provides one. A chunk that cannot say where it came from cannot support a citation, and a claim without a citation does not ship.
- **Choose a strategy that respects document structure.** Fixed-size splitting will cut a numbered recommendation or a storage-time table in half, which produces chunks that retrieve well and cite badly — the number is there, the thing it applies to is in the neighbouring chunk.
- **Tables are the hard case.** Decide explicitly how table content is handled — kept whole, flattened to prose, or extracted separately — and accept that whatever is chosen costs something.
- **State in the README**: the chunking approach, chunk size, overlap, and what the choice cost. "What it cost" is a required part of the answer, not a flourish: every strategy loses something, and naming the loss is the deliverable.

#### 3. Retrieval

Build a vector index over the chunks.

**Requirements:**

- **Two retrieval modes**, both of which must work: across all documents, and filtered to one named document.
- **Fixed, recorded parameters**: embedding model, index type, and the `k` value used at answer time, all stated in the README. These must be fixed before the question bank is run, since changing them changes the hit rate.
- **Chunk metadata comes back with the chunk.** Retrieval returns provenance, not just text — the answer layer cannot cite what retrieval did not hand it.
- **The retrieval set is recorded per answer**, so the sources panel can show the chunks behind the answer and a not-in-corpus refusal can name what was searched.

#### 4. Answer Layer

The assistant answers only from retrieved chunks. Every claim carries a citation showing document name, publisher, year and a link.

**Requirements:**

- **Retrieved text is the only source.** Model knowledge is not a source. A claim the retrieved chunks do not support does not ship, even when it is true.
- **Every claim carries a citation** identifying document name, publisher, year and a link. A claim with no citation is a defect, not a degraded answer.
- **One claim, one source.** A claim cites the chunk it came from. Claims are not merged across documents (see cross-document questions below).
- **Numbers and named recommendations must appear in the cited chunk.** This is the property the citation spot-check verifies, and the direct answer to the Milestone 1 `numeric_drift` failures: a number that has to be present in a retrieved chunk cannot drift between runs.
- **Population-level guidance stays population-level.** Retrieved text that describes a recommendation for adults generally must not be rendered as advice for the person asking.
- **Citation fabrication must be structurally impossible, not merely discouraged.** Milestone 1 forces every `source` to `null` in code regardless of what the model returns, as defence in depth against a fabricated citation. Milestone 2 removes that clamp, and must replace it with an equivalent guarantee — a citation that does not correspond to a chunk actually retrieved for that request must not be able to reach the response.

#### 5. Cross-Document Questions

Some questions have two documents with something to say — cooking oil, for example, where a nutrition institute and a food safety regulator both weigh in.

**Requirements:**

- **Answer per document, with separate citations.** Two documents with something to say produce two sets of claims, each citing its own source.
- **Never blend two sources into one claim** about what "the guidelines say". The phrase itself is the smell: there is no single set of guidelines, there are documents with publishers and years.
- **When two documents disagree, show both**, with their publishers and years, and do not pick a winner. A year difference is information the reader needs, not a tiebreaker for the assistant to apply silently.
- **At least one question bank entry must exercise this path**, drawn from the deliberate corpus overlap recorded in step 1.

#### 6. Two Kinds of Refusal

Both are required, and they are different mechanisms with different messages.

- **Not in the corpus** — when the retrieved chunks don't hold the answer, the assistant says the guidance doesn't cover it and names what it searched. This is a retrieval-time decision: it needs an explicit rule for when retrieved chunks are judged insufficient, and that rule must fire before the model is asked to write an answer from inadequate material.
- **Out of scope by design** — no medical advice, no calorie or weight targets, nothing about what anyone should weigh. The assistant declines and points the person to a qualified professional. Enforce this in code, same as Milestone 1: before retrieval, against conversation history as well as the current message, and applying to rephrased, indirect and later-in-conversation restatements.

**Precedence is part of the specification.** The out-of-scope check runs first, before retrieval and before any model call. A request for a calorie target is declined as out of scope whether or not the corpus happens to contain calorie numbers — it must never be answered from a chunk, and it must never be reported as a not-in-corpus miss.

**The near-miss case belongs to the not-in-corpus refusal.** A question worded to match a nearly-correct section — children's requirements, when the corpus covers adults — retrieves chunks with high surface similarity and the wrong scope. Answering from them is a retrieval failure dressed as a confident answer, and is the single most likely way this milestone fails quietly.

#### 7. Filling in the Shell

Don't rebuild the frontend or backend. The sources panel left empty in Milestone 1 now shows the chunks behind each answer. The `source` field on every claim carries a real citation instead of `null`.

**What changes, concretely:**

- **`lib/schema.ts` — the citation shape.** `ClaimSchema.source` is `z.null()` today, with a code comment planning to widen it to `z.string().url().nullable()`. **That plan is insufficient and must be revised**: a bare URL string cannot carry document name, publisher and year, which this milestone requires on every claim. `source` becomes a structured citation object — document, publisher, year, url, and section/page where available — nullable only for the refusal paths that produce no claims. Record this change and the reason, as the brief requires.
- **`prisma/schema.prisma` — citation persistence.** `Claim.source` is a nullable `String` column. A structured citation needs either a JSON column, additional columns, or a relation to stored chunk and document records. Decide which, and note that the corpus itself — documents, chunks, embeddings — needs storage that Milestone 1's data model has no equivalent of.
- **`components/SourcesPanel.tsx` — the unreachable branch.** The populated-source branch was written in Milestone 1 and has never run. It currently renders `claim.source` as both the link target and the visible link text, which only works for a bare URL. It must be updated to render a real citation: document name, publisher, year, section, and a link — plus the retrieved chunk text behind the answer.
- **The response envelope stays frozen.** `{ conversationId, answer, claims[] }` keeps its shape. Any retrieval metadata the UI needs — what was searched, which document filter applied, the chunks retrieved — is added as new fields, not by reshaping what exists.
- **The system prompt** (`lib/systemPrompt.ts`) gains the grounding instruction: answer from provided chunks only, decompose into claims attributable to specific chunks, refuse when the chunks do not cover the question. The out-of-scope categories stay, since the prompt is defence in depth and not the enforcement layer.
- **`scripts/evaluate.ts`** keeps the existing 3-runs-per-question structure and failure-log grouping, and gains retrieval metrics. Its prompt-version grouping (a hash of the system prompt) should extend to retrieval configuration, since a changed `k` or embedding model changes results as surely as a changed prompt.

### Rules

- Answers come from retrieved text only. Model knowledge is not a source.
- Every claim carries a citation. No citation means the claim doesn't ship.
- Population-level guidance stays population-level. The assistant doesn't turn it into a personal recommendation.
- No calorie targets, no weight targets, no medical advice, anywhere in the conversation.
- When two documents disagree, show both with their publishers and years. Don't pick a winner.
- 5 to 7 documents in the corpus.
- State chunk size, overlap, embedding model, index type and `k` value in the README.

### Suggested Tools

- **PDF parsing:** PyMuPDF, Unstructured, Docling or LlamaParse.
- **Chunking:** LangChain text splitters, or a custom splitter that breaks on section headings.
- **Embeddings:** OpenAI `text-embedding-3-small`, Cohere embed, or `sentence-transformers` to keep it local and free.
- **Vector store:** Supabase pgvector, Pinecone or Qdrant if hosted.
- **Orchestration:** LangChain, or plain code if you want to see every step.
- **Everything else:** same stack as Milestone 1.

### Constraints Carried Over From Milestone 1

These are properties of the existing deployment that Milestone 2 has to work within.

- **Ingestion is offline; the request path is not.** Parsing, chunking and embedding the corpus is a build-time job, run once per corpus change, and can use a different toolchain from the app. Only retrieval and generation run per request. Several of the suggested tools are Python; the app is TypeScript. Either is acceptable for an offline ingestion script — what matters is that the chunks and their metadata land somewhere the app can query, and that the script is reproducible and committed.
- **Token budget per request gets tighter, not looser.** RAG prepends retrieved chunks to every prompt. The existing rate limiter targets a tokens-per-minute safety margin under the provider's tier cap, and that margin was sized for prompts without retrieved context. Chunk size times `k` lands directly in this budget, so the `k` and chunk-size decisions are cost decisions as well as quality decisions.
- **The generation provider may not provide embeddings.** Generation runs on Groq. Embeddings likely need a separate provider or a local model — confirm what is available before fixing the embedding-model decision, since it determines whether embedding happens offline, per request, or both.
- **Serverless has no local filesystem to lean on.** One deploy target runs on serverless functions with an ephemeral filesystem, which is why the database is Postgres rather than SQLite. A vector index stored as a local file will not survive there. An index living in the Postgres instance both deployments already share is the path of least resistance; a hosted vector service is the alternative. Either way, the index must not be a file on disk.
- **Two deploy targets, one database, different deploy triggers.** Both deployments point at the same Postgres. One auto-deploys on push, the other only deploys when published manually. A corpus or index migration therefore goes live on one target before the other, and a schema change that both targets read must be backwards-compatible for the window between the two deploys. Plan the ingestion and migration order accordingly.

### Open Decisions

To be resolved and recorded in the README before the question bank is run, since each one changes the measured results:

1. Which 5–7 documents, and which topic is the deliberate cross-document overlap.
2. Chunking strategy, size and overlap — and the explicit answer for tables.
3. Embedding model, and whether embedding runs offline only.
4. Where the vector index lives.
5. The `k` value, and the rule for judging retrieved chunks insufficient (the not-in-corpus trigger).
6. The persisted citation shape, and whether chunks are stored as rows or only as index payloads.

### Verification Before Submission

Four separate exercises. They answer different questions and are not substitutes for one another.

#### Retrieval question bank — at least 15 questions

- Write at least 15 questions where the correct document and section is already known, before running anything.
- Cover every document in the corpus, and include the cross-document question from the deliberate overlap.
- For each question, check whether the right chunk came back in the top-k, and **report the hit rate** — overall and per document, so a single weak document is visible rather than averaged away.
- Report the false-refusal rate too: answerable questions the assistant refused anyway.
- **Why this is separate from answer quality:** a wrong answer can come from bad retrieval or bad generation, and the fix is different for each. The hit rate isolates retrieval. Without it, a generation fix gets applied to a retrieval problem.

#### Adversarial testing

- **Not covered at all** — ask something none of the documents cover. It should refuse, and name what it searched.
- **Near miss** — ask something worded to match a nearly correct section, such as children's requirements when the corpus only covers adults. It must not answer from the wrong section. Use the corpus boundary recorded in step 1 to construct these.
- **Out of scope** — ask for a calorie target and for medical advice. Rephrase both. Ask indirectly. Bring them up again later in the same conversation, after unrelated messages. It should decline every time, and decline as out-of-scope rather than as not-in-corpus.
- Report results split by refusal type, so a correct refusal for the wrong reason is visible.

#### Citation spot-check — 10 answers

- Take 10 answers, open the chunk each one cited, and confirm **every number and named recommendation is actually in there**.
- Check by hand. This is the one measurement that cannot be automated against the same embeddings that produced the retrieval, since a retrieval bug and its automated check would share the failure.
- Report per-claim and per-answer accuracy: one bad claim in an otherwise good answer is still a shipped unsupported claim.

#### Milestone 1 regression comparison

- Put the same ten Milestone 1 questions through this version and report before and after.
- Compare against the recorded Milestone 1 baseline, using the same failure categories: **4 `numeric_drift` instances** is the number to beat, and the drift categories to watch are protein requirements, egg storage, cooked-rice storage and blanching time.
- Expect the `no_clear_answer` questions ("is quinoa a superfood", "what is the single best diet") to change character: in Milestone 1 they produced hedging, and in Milestone 2 they should produce either cited population-level guidance or a not-in-corpus refusal. Report which.
- Report regressions as well as improvements. A question Milestone 1 answered well and Milestone 2 refuses is a real cost, and belongs in the comparison.

### Acceptance Criteria

Milestone 2 is complete when all of the following hold:

- [ ] 5–7 qualifying documents in the corpus, each with publisher, year, source URL and retrieval date recorded.
- [ ] Every chunk carries document name, publisher, year and section heading.
- [ ] Retrieval works across all documents and filtered to one named document.
- [ ] Every claim in every shipped answer carries a citation with document name, publisher, year and link.
- [ ] No claim's citation points at a chunk that was not retrieved for that request.
- [ ] Cross-document questions produce per-document claims with separate citations, and disagreements show both publishers and years without a winner being picked.
- [ ] Not-in-corpus refusal fires when retrieved chunks are insufficient, and names what was searched.
- [ ] Out-of-scope refusal is enforced in code, runs before retrieval, and survives rephrasing, indirection and re-raising later in the same conversation.
- [ ] The response envelope `{ conversationId, answer, claims[] }` is unchanged in shape.
- [ ] The sources panel shows the chunks behind the selected answer, with real citations.
- [ ] README states chunk size, overlap, embedding model, index type and `k` value, plus the chunking strategy and what it cost.
- [ ] Question bank of 15+ questions run, with hit rate reported overall and per document.
- [ ] 10 citations spot-checked by hand against their source chunks.
- [ ] Milestone 1's ten questions re-run, with a before/after comparison against the logged failure baseline.
- [ ] Deployed and live, both deploy targets updated.

### Expected Deliverables

- A live chatbot with retrieval-backed answers
- A corpus of 5 to 7 public guidance documents, each with publisher, year, source URL and retrieval date recorded
- A committed, reproducible ingestion script covering parsing, chunking and embedding
- A documented chunking strategy, including its tradeoffs
- A vector index supporting both all-document and single-document retrieval
- A revised claim schema with a structured citation, and a note on what changed and why
- A populated `source` field on every claim, with document name, publisher, year and link
- Per-document citations on cross-document questions, with no blended "the guidelines say" claims
- Code-enforced handling of both refusal types: not-in-corpus and out-of-scope
- A 15-question retrieval question bank with top-k hit-rate results, reported per document
- An adversarial test report covering not-covered, near-miss and out-of-scope cases
- A README stating chunk size, overlap, embedding model, index type and `k` value
- A spot-check of 10 citations against their source chunks
- A before/after comparison against the Milestone 1 failure log, including regressions

---

## Milestone 3: Structured Nutrient Data (Looking Ahead)

Recorded here only to keep the boundary clear while Milestone 2 is built.

- Per-food nutrient numbers come from a structured database, not from the prose corpus. Questions like "how much iron is in 100g of spinach" are answered from structured data with its own provenance.
- The guidance corpus remains the source for population-level advice and food safety rules. A question can need both: "is this a reasonable way to eat" draws on guidance, "how much protein is in this" draws on the database.
- The scope restrictions do not relax. Structured nutrient data makes calorie arithmetic trivially available, which makes the code-level refusal of calorie and weight targets more load-bearing, not less.
