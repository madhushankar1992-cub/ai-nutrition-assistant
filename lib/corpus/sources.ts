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
    name: "Healthy diet (fact sheet)",
    publisher: "World Health Organization",
    year: 2026,
    // Was /publications/m/item/healthy-diet-factsheet394 — a publication STUB
    // carrying only a 700-word overview and a download link. It fetched 200 and
    // read as a plausible document, so nothing flagged it, but the numbers the
    // corpus needs were simply not in it: "400 g fruit and vegetables" never
    // appeared, and the fruit/veg question could not be answered from any
    // document. The news-room fact sheet is the full text (3,000 words) and is
    // the edition WHO currently maintains.
    url: "https://www.who.int/news-room/fact-sheets/detail/healthy-diet",
    fileUrl: "https://www.who.int/news-room/fact-sheets/detail/healthy-diet",
    acquisition: "fetched",
    expectTitleContains: "Healthy diet",
    enabled: true,
    notes:
      "Updated 26 Jan 2026. Densest population-level numbers in the corpus: >=400 g fruit/veg, free sugars <10%E, salt <5 g/day (2 g sodium), fibre >=25 g. Mentions a 2,000-calorie reference, so chunks here can be flagged restricted.",
  },
  {
    key: "efsa-drv-summary",
    name: "Dietary Reference Values for nutrients: Summary report",
    publisher: "European Food Safety Authority",
    year: 2017,
    // The landing page returns 403 to every non-browser client, so it is not
    // usable as a citation link that anything can verify. The PDF is the
    // document itself and serves 200, so url and fileUrl are the same here.
    url: "https://www.efsa.europa.eu/sites/default/files/2017_09_DRVs_summary_report.pdf",
    fileUrl: "https://www.efsa.europa.eu/sites/default/files/2017_09_DRVs_summary_report.pdf",
    acquisition: "fetched",
    expectTitleContains: "Dietary Reference Values for nutrients",
    expectYearIn: [2017],
    enabled: true,
    notes:
      "92 pp, 48,717 words, 133 numeric statements. Cited directly as the PDF: the EFSA landing page 403s to all programmatic clients.",
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
