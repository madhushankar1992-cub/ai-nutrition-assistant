// Turn fetched bytes into text plus the measurements the watcher needs to
// decide whether a document is still the document we think it is.
//
// Text is extracted PER PAGE, not as one blob, because the quality gate has to
// run per page. The Eatwell Guide is the case that forced this: page 1 is the
// plate artwork and extracts as a word-salad of food names, while pages 2-12
// are clean prose at ~430 words/page. A document-level average passes it and
// still leaves one unusable page in the index.

export interface ExtractedPage {
  pageNumber: number;
  text: string;
  wordCount: number;
  /** Sentence-ending marks per 100 words. Prose sits around 4-8; labels sit near 0. */
  proseDensity: number;
  /** Fraction of tokens containing a digit. Tables run high; diagrams run near zero. */
  digitRatio: number;
}

export interface ExtractionResult {
  kind: "pdf" | "html" | "text" | "unknown";
  pageCount: number;
  wordCount: number;
  wordsPerPage: number;
  /** Document title from PDF metadata or the HTML <title>, when present. */
  title: string | null;
  /** Any 19xx/20xx year found near the start — a weak signal, cross-checked elsewhere. */
  years: number[];
  pages: ExtractedPage[];
  /** Pages below the words-per-page floor; scans, covers, or blank pages. */
  lowTextPages: number[];
  /**
   * Pages with plenty of words but almost no sentences — diagrams and labelled
   * artwork. These are the dangerous ones: they pass a word-count gate, embed
   * happily, match food-name queries, and cite terribly.
   */
  artworkPages: number[];
  /**
   * Pages that are mostly tabular data. Not a defect — these carry the numbers
   * the corpus exists for, and chunking must keep them whole.
   */
  tablePages: number[];
  text: string;
}

/** Below this, a page is almost certainly a cover, a scan, or blank. */
export const LOW_TEXT_PAGE_FLOOR = 40;

/**
 * A page needs at least this many sentence-ending marks per 100 words to count
 * as prose. The Eatwell Guide's plate page is the case this exists for: it
 * extracts ~300 words of food names ("Crisps Raisins Frozen peas Lentils...")
 * with virtually no sentence punctuation, so a word-count gate passes it.
 */
export const MIN_PROSE_DENSITY = 1.2;

/**
 * Low prose density alone is NOT enough to call a page artwork, because data
 * tables look identical by that measure — and in a reference-values document
 * the tables are the most valuable content there is. Running this check against
 * the real corpus flagged 18 EFSA pages as "artwork" when they were the
 * nutrient tables.
 *
 * Digits are what separates the two: a reference table is dense with numbers, a
 * labelled diagram is nearly all words. So a page is only artwork when it has
 * few sentences AND few numbers.
 */
export const TABLE_DIGIT_RATIO = 0.12;

/** Only judge these ratios once there are enough words for them to mean anything. */
const PROSE_DENSITY_MIN_WORDS = 60;

const countWords = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

function proseDensity(text: string, wordCount: number): number {
  if (!wordCount) return 0;
  const sentenceMarks = (text.match(/[.!?](\s|$)/g) ?? []).length;
  return (sentenceMarks / wordCount) * 100;
}

function digitRatio(text: string, wordCount: number): number {
  if (!wordCount) return 0;
  const numericTokens = (text.trim().split(/\s+/).filter((t) => /\d/.test(t))).length;
  return numericTokens / wordCount;
}

function makePage(text: string, pageNumber: number): ExtractedPage {
  const t = text ?? "";
  const wordCount = countWords(t);
  return {
    pageNumber,
    text: t,
    wordCount,
    proseDensity: proseDensity(t, wordCount),
    digitRatio: digitRatio(t, wordCount),
  };
}

const isLowProse = (p: ExtractedPage) =>
  p.wordCount >= PROSE_DENSITY_MIN_WORDS && p.proseDensity < MIN_PROSE_DENSITY;

/**
 * A numbered table caption settles it outright.
 *
 * Digit ratio alone is not sufficient: EFSA page 85 is "Table 14: Concise table
 * on data used to set DRVs for children (1-17 years)", whose criteria column is
 * mostly words, so it scored below the digit threshold and was misread as
 * artwork. Dropping it would have silently removed children's reference values
 * from the corpus.
 */
const TABLE_CAPTION = /\bTable\s+\d+\s*[:.]/i;

const looksLikeTable = (p: ExtractedPage) =>
  p.digitRatio >= TABLE_DIGIT_RATIO || TABLE_CAPTION.test(p.text);

/** Few sentences, few numbers, no table caption: a labelled diagram. Drop at ingestion. */
function findArtworkPages(pages: ExtractedPage[]): number[] {
  return pages.filter((p) => isLowProse(p) && !looksLikeTable(p)).map((p) => p.pageNumber);
}

/** Low prose but tabular: real data. Keep these — and never split them (see chunking). */
function findTablePages(pages: ExtractedPage[]): number[] {
  return pages.filter((p) => isLowProse(p) && looksLikeTable(p)).map((p) => p.pageNumber);
}

function collectYears(text: string): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(/\b(19[5-9]\d|20[0-4]\d)\b/g)) {
    found.add(Number(m[1]));
  }
  return [...found].sort((a, b) => a - b);
}

function htmlToText(html: string): { text: string; title: string | null } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() || null : null;

  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, title };
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    mdash: "—", ndash: "–", hellip: "…", deg: "°",
    rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
  };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}

async function extractPdf(bytes: Buffer): Promise<ExtractionResult> {
  // unpdf bundles a serverless-safe pdf.js build; imported lazily so the HTML
  // path never pays for loading it.
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));

  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pageTexts: string[] = Array.isArray(text) ? text : [String(text)];

  let title: string | null = null;
  try {
    const meta = (await pdf.getMetadata()) as { info?: { Title?: string } };
    title = meta?.info?.Title?.trim() || null;
  } catch {
    // Metadata is optional; several corpus PDFs have an empty info dictionary.
  }

  const pages: ExtractedPage[] = pageTexts.map((t, i) => makePage(t, i + 1));
  const full = pages.map((p) => p.text).join("\n");
  const wordCount = pages.reduce((sum, p) => sum + p.wordCount, 0);
  const pageCount = totalPages || pages.length;

  // Fall back to the first page's text when metadata carries no title — the
  // ICMR-NIN file is exactly this: empty /Title, real title on page 2.
  if (!title) {
    const head = full.slice(0, 600).split("\n").map((l) => l.trim()).filter(Boolean);
    title = head.slice(0, 4).join(" ") || null;
  }

  return {
    kind: "pdf",
    pageCount,
    wordCount,
    wordsPerPage: pageCount ? Math.round(wordCount / pageCount) : 0,
    title,
    years: collectYears(full.slice(0, 6000)),
    pages,
    lowTextPages: pages.filter((p) => p.wordCount < LOW_TEXT_PAGE_FLOOR).map((p) => p.pageNumber),
    artworkPages: findArtworkPages(pages),
    tablePages: findTablePages(pages),
    text: full,
  };
}

function extractHtml(bytes: Buffer): ExtractionResult {
  const { text, title } = htmlToText(bytes.toString("utf8"));
  const page = makePage(text, 1);
  return {
    kind: "html",
    pageCount: 1,
    wordCount: page.wordCount,
    wordsPerPage: page.wordCount,
    title,
    years: collectYears(text.slice(0, 6000)),
    pages: [page],
    lowTextPages: page.wordCount < LOW_TEXT_PAGE_FLOOR ? [1] : [],
    // Artwork/table detection is page-level and only meaningful for PDFs; an HTML
    // landing page is one 'page' of mixed navigation and prose.
    artworkPages: [],
    tablePages: [],
    text,
  };
}

export async function extractDocument(
  bytes: Buffer,
  contentType: string | null
): Promise<ExtractionResult> {
  const isPdf =
    (contentType ?? "").includes("application/pdf") ||
    bytes.subarray(0, 5).toString("latin1") === "%PDF-";

  if (isPdf) return extractPdf(bytes);
  if ((contentType ?? "").includes("html")) return extractHtml(bytes);

  const text = bytes.toString("utf8");
  const page = makePage(text, 1);
  return {
    kind: (contentType ?? "").startsWith("text/") ? "text" : "unknown",
    pageCount: 1,
    wordCount: page.wordCount,
    wordsPerPage: page.wordCount,
    title: null,
    years: collectYears(text.slice(0, 6000)),
    pages: [page],
    lowTextPages: [],
    artworkPages: [],
    tablePages: [],
    text,
  };
}
