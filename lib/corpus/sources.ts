// The corpus registry: which guidance documents the assistant may cite.
//
// Every entry here was fetched and inspected on 2026-10-02 — status codes,
// titles, years and word counts are measured, not assumed. See
// Docs/problemStatement.md for the full check and Docs/rag-architecture.md §5.
//
// `expectTitleContains` / `expectYearIn` are the edition guard. Two candidates
// returned HTTP 200 while being the WRONG EDITION (the US guidelines moved to a
// 2025-2030 edition; the only downloadable ICMR-NIN file is the 2011 manual, not
// the 2024 revision). Citing those would be a fabricated citation behind a
// working link, so the watcher treats an expectation mismatch as a hard failure.

export type Acquisition = "fetched" | "manual";

export interface CorpusSourceDef {
  /** Stable key — used as the DB primary key and in reports. Never reuse one. */
  key: string;
  name: string;
  publisher: string;
  /** Publication year, read from inside the document. */
  year: number;
  edition?: string;
  /** Reader-facing URL. This is what a citation links to. */
  url: string;
  /**
   * What the watcher actually fetches. Differs from `url` when the landing page
   * is bot-blocked but the file is not — EFSA is exactly this case.
   */
  fileUrl: string;
  acquisition: Acquisition;
  expectTitleContains?: string;
  expectYearIn?: number[];
  /** Skip without deleting — keeps history and the reason in one place. */
  enabled: boolean;
  notes?: string;
}

export const CORPUS_SOURCES: CorpusSourceDef[] = [
  {
    key: "who-healthy-diet-factsheet",
    name: "Healthy diet (Fact sheet No. 394)",
    publisher: "World Health Organization",
    year: 2018,
    url: "https://www.who.int/publications/m/item/healthy-diet-factsheet394",
    fileUrl: "https://www.who.int/publications/m/item/healthy-diet-factsheet394",
    acquisition: "fetched",
    expectTitleContains: "Healthy diet",
    enabled: true,
    notes: "Densest population-level numbers per page: >=400 g fruit/veg, fat <30%E, salt <5 g/day.",
  },
  {
    key: "efsa-drv-summary",
    name: "Dietary Reference Values for nutrients: Summary report",
    publisher: "European Food Safety Authority",
    year: 2017,
    url: "https://www.efsa.europa.eu/en/supporting/pub/e15121",
    fileUrl: "https://www.efsa.europa.eu/sites/default/files/2017_09_DRVs_summary_report.pdf",
    acquisition: "fetched",
    expectTitleContains: "Dietary Reference Values for nutrients",
    expectYearIn: [2017],
    enabled: true,
    notes:
      "92 pp, 48,717 words, 133 numeric statements. Landing page 403s to bots while the PDF does not — hence url != fileUrl.",
  },
  {
    key: "dga-2025-2030",
    name: "Dietary Guidelines for Americans, 2025-2030",
    publisher: "U.S. Departments of Agriculture and Health and Human Services",
    year: 2026,
    edition: "10th edition",
    url: "https://odphp.health.gov/our-work/nutrition-physical-activity/dietary-guidelines/current-dietary-guidelines",
    fileUrl: "https://cdn.realfood.gov/DGA.pdf",
    acquisition: "fetched",
    expectTitleContains: "Dietary Guidelines for Americans, 2025",
    expectYearIn: [2025, 2026],
    enabled: true,
    notes:
      "Only 2,704 words (~7 chunks). Supersedes the widely-cited 2020-2025 edition. Contains per-kg-bodyweight protein and 2,000-calorie patterns — flag chunks as restricted.",
  },
  {
    key: "phe-eatwell-guide",
    name: "The Eatwell Guide (booklet)",
    publisher: "Public Health England",
    year: 2018,
    url: "https://www.gov.uk/government/publications/the-eatwell-guide",
    fileUrl:
      "https://assets.publishing.service.gov.uk/media/5ba8a50540f0b605084c9501/Eatwell_Guide_booklet_2018v4.pdf",
    acquisition: "fetched",
    expectTitleContains: "Eatwell Guide",
    enabled: true,
    notes: "12 pp, 5,166 words. Page 1 is artwork — drop it at ingestion, keep pages 2-12.",
  },
  {
    key: "who-five-keys",
    name: "Five keys to safer food manual",
    publisher: "World Health Organization",
    year: 2006,
    url: "https://www.who.int/publications/i/item/9789241594639",
    fileUrl: "https://www.who.int/publications/i/item/9789241594639",
    acquisition: "fetched",
    expectTitleContains: "Five keys",
    enabled: true,
    notes: "Prose replacement for the bot-blocked US food-safety charts.",
  },
  {
    key: "fsa-chill-freeze-defrost",
    name: "How to chill, freeze and defrost food safely",
    publisher: "Food Standards Agency",
    year: 2017,
    url: "https://www.gov.uk/government/publications/how-to-chill-freeze-and-defrost-food-safely",
    fileUrl:
      "https://www.gov.uk/government/publications/how-to-chill-freeze-and-defrost-food-safely/how-to-chill-freeze-and-defrost-food-safely",
    acquisition: "fetched",
    expectTitleContains: "chill, freeze and defrost",
    enabled: true,
    notes:
      "Verified: fridge 0-5C, chill within 1-2 h, leftovers within 48 h, freezer -18C, use within 24 h of defrosting. Disagrees with FoodSafety.gov (3-4 days) — the cross-document test case.",
  },
  {
    key: "who-sodium-guideline",
    name: "Guideline: sodium intake for adults and children",
    publisher: "World Health Organization",
    year: 2012,
    url: "https://www.who.int/publications-detail-redirect/9789241504836",
    // Watched via the publication page, not the IRIS bitstream: iris.who.int is a
    // JS-rendered DSpace app whose /bitstream/ path returns an HTML shell with no
    // document text (the watcher caught this — it read a 1-word page titled
    // "DSpace"). The publication page still changes when WHO supersedes the
    // guideline, which is what the watcher needs to detect. The PDF itself is
    // resolved by hand at ingestion time.
    fileUrl: "https://www.who.int/publications/i/item/9789241504836",
    acquisition: "fetched",
    expectTitleContains: "odium",
    enabled: true,
    notes: "Single-nutrient guideline — exercises single-document filtered retrieval.",
  },

  // --- Hard-blocked to programmatic clients (HTTP 403 even with a browser UA).
  // Kept in the registry so the watcher reports them as needing manual refresh
  // rather than silently omitting them from the corpus.
  {
    key: "foodsafety-cold-storage",
    name: "Cold Food Storage Charts",
    publisher: "FoodSafety.gov (U.S. Department of Health and Human Services)",
    year: 2026,
    url: "https://www.foodsafety.gov/food-safety-charts/cold-food-storage-charts",
    fileUrl: "https://www.foodsafety.gov/food-safety-charts/cold-food-storage-charts",
    acquisition: "manual",
    enabled: true,
    notes:
      "403 to all programmatic clients. Save by hand into corpus/raw/. Holds the egg and leftover storage tables; its '3-4 days' leftover figure is still UNVERIFIED against the source.",
  },
  {
    key: "usda-fsis-safe-temperatures",
    name: "Safe Minimum Internal Temperature Chart",
    publisher: "USDA Food Safety and Inspection Service",
    year: 2026,
    url: "https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/safe-temperature-chart",
    fileUrl:
      "https://www.fsis.usda.gov/food-safety/safe-food-handling-and-preparation/food-safety-basics/safe-temperature-chart",
    acquisition: "manual",
    enabled: true,
    notes: "403 to all programmatic clients. Covers the chicken-temperature eval question.",
  },
];

export function getSource(key: string): CorpusSourceDef | undefined {
  return CORPUS_SOURCES.find((s) => s.key === key);
}

export function enabledSources(): CorpusSourceDef[] {
  return CORPUS_SOURCES.filter((s) => s.enabled);
}

/** Sources the watcher can actually fetch; `manual` ones are reported, not fetched. */
export function fetchableSources(): CorpusSourceDef[] {
  return enabledSources().filter((s) => s.acquisition === "fetched");
}
