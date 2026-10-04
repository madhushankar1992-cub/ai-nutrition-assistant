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

/**
 * Elements that are page furniture on every site, never document content.
 *
 * Measured cost of not removing these: the WHO fact sheet ingested as 7 chunks
 * of which 6 were pure navigation — "Skip to main content Global Regions ...
 * Dengue Endometriosis Mpox", "Cybersecurity Ethics Information disclosure".
 * Such chunks embed happily, match any food query weakly, and crowd real
 * passages out of the top-k. The single chunk holding actual guidance ranked
 * 27th on a question that only it could answer.
 */
const CHROME_TAGS = [
  "nav", "header", "footer", "aside", "form", "svg", "button",
  "select", "dialog", "iframe", "template",
];

/**
 * Containers on a who.int PUBLICATION page (/publications/i/item/...) that sit
 * inside the <article> but carry no guidance. Matched by whole class token.
 *
 *   dynamic-content__details    the catalogue sidebar: "Editors / Number of
 *                               pages 28 / Reference numbers / ISBN /
 *                               Copyright". Ingested as its own chunk under a
 *                               section called "Editors".
 *   dynamic-content__accordion  the language switcher ("العربية 中文 Français
 *                               Русский Español") and the "Systematic reviews",
 *                               "More information" and "Related publications"
 *                               link lists. Ingested as a chunk filed under a
 *                               section called "Français".
 *   button-blue-background      the "Download (403.2 kB)" button.
 *
 * Both junk chunks were kind=prose, so they were retrievable and citable, and
 * deleting them from the store was useless: the daily ingest recreated them.
 * The overview prose sits in dynamic-content__description, a sibling of the
 * accordion, so removing these leaves the guidance text untouched. None of the
 * other HTML sources (WHO fact sheet, gov.uk) use these classes.
 */
const PUBLICATION_PAGE_CHROME_CLASSES = [
  "dynamic-content__details",
  "dynamic-content__accordion",
  "button-blue-background",
];

/**
 * Remove every element whose class list contains one of `classNames`, together
 * with everything nested inside it.
 *
 * A lazy regex cannot do this: these containers are <div>s holding <div>s, so
 * `<div ...>[\s\S]*?</div>` stops at the first inner close and leaves the rest
 * of the block behind. Instead, count same-name opens and closes from the
 * matched start tag until they balance. If they never balance (truncated or
 * malformed markup) the element is left in place: keeping a little chrome is
 * better than deleting the rest of the document.
 */
function removeElementsByClass(html: string, classNames: string[]): string {
  const startTag = /<([a-z][a-z0-9]*)\b[^>]*\bclass\s*=\s*(["'])([^"']*)\2[^>]*>/gi;
  let out = html;
  let searchFrom = 0;

  for (;;) {
    startTag.lastIndex = searchFrom;
    let m: RegExpExecArray | null;
    let hit: RegExpExecArray | null = null;
    while ((m = startTag.exec(out))) {
      const tokens = m[3].split(/\s+/);
      if (classNames.some((c) => tokens.includes(c))) {
        hit = m;
        break;
      }
    }
    if (!hit) return out;

    const tag = hit[1].toLowerCase();
    const start = hit.index;
    const tagPattern = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi");
    tagPattern.lastIndex = start + hit[0].length;
    let depth = 1;
    let end = -1;
    let t: RegExpExecArray | null;
    while ((t = tagPattern.exec(out))) {
      if (t[0].endsWith("/>")) continue;
      depth += t[1] ? -1 : 1;
      if (depth === 0) {
        end = t.index + t[0].length;
        break;
      }
    }

    if (end < 0) {
      searchFrom = start + hit[0].length;
      continue;
    }
    out = out.slice(0, start) + " " + out.slice(end);
    searchFrom = start;
  }
}

/** Below this, assume the content container was guessed wrong and use the page. */
const HTML_MAIN_MIN_WORDS = 50;

/**
 * Prefix marking a line that was a real <h1>-<h6> in the source HTML, so the
 * chunker can take the document's own section structure instead of inferring
 * one from capitalisation. Chosen to be absent from running prose.
 */
export const HTML_HEADING_MARKER = "[[H]] ";

const stripTags = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/**
 * Narrow to the document's content container before stripping anything else.
 *
 * Only an UNAMBIGUOUS container is used — exactly one <main> or one <article>
 * in the page. With more than one there is no way to tell content from a
 * sidebar teaser without a real DOM, and guessing wrong silently deletes the
 * document. Every HTML source in this corpus has exactly one: gov.uk uses
 * <main id="content">, who.int uses <article class="sf-detail-body-wrapper">.
 */
function isolateMainContent(html: string): string {
  for (const tag of ["main", "article"]) {
    const opens = html.match(new RegExp(`<${tag}[\\s>]`, "gi")) ?? [];
    if (opens.length !== 1) continue;

    const matched = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*)</${tag}>`, "i"));
    if (!matched) continue;

    // Accept only if real text survives — a wrong container is worse than none.
    if (countWords(stripTags(matched[1])) >= HTML_MAIN_MIN_WORDS) return matched[1];
  }
  return html;
}

function htmlToText(html: string): { text: string; title: string | null } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() || null : null;

  // Scripts and comments go first: a <nav> mentioned inside a script string
  // would otherwise unbalance the chrome removal below.
  let body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  body = isolateMainContent(body);
  body = removeElementsByClass(body, PUBLICATION_PAGE_CHROME_CLASSES);
  for (const tag of CHROME_TAGS) {
    body = body.replace(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, "gi"), " ");
  }

  // Mark real <h1>-<h6> headings before the tags are discarded.
  //
  // Section detection on a PDF has to guess from typography, and that guess
  // then ran on HTML too, where the answer is already in the markup. It guessed
  // wrong: "Salt/sodium and potassium" failed the title-case test (one of its
  // two long words is lowercase), so the WHO passage stating the 5 g salt limit
  // was filed under the preceding heading, "Protein" — a citation pointing the
  // reader at the wrong section of the document.
  body = body.replace(
    /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi,
    (_, inner: string) => `\n${HTML_HEADING_MARKER}${stripTags(inner)}\n`
  );

  const text = decodeEntities(
    body
      // A block element opens a new line as well as closing one, so text is
      // never glued to the paragraph above it — section detection reads lines.
      .replace(/<(p|div|section|li|tr)\b[^>]*>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote)>/gi, "\n")
      .replace(/<\/(td|th)>/gi, " ")
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
    // Accented letters and symbols that real sources contain. Undecoded, they
    // reached stored chunks and citations: "&alpha;-linolenic acid" in a WHO
    // passage, and "Fran&ccedil;ais" as a WHO citation's section label.
    aacute: "á", agrave: "à", acirc: "â", atilde: "ã", auml: "ä", aring: "å",
    eacute: "é", egrave: "è", ecirc: "ê", euml: "ë",
    iacute: "í", igrave: "ì", icirc: "î", iuml: "ï",
    oacute: "ó", ograve: "ò", ocirc: "ô", otilde: "õ", ouml: "ö",
    uacute: "ú", ugrave: "ù", ucirc: "û", uuml: "ü",
    ccedil: "ç", ntilde: "ñ", szlig: "ß", oslash: "ø", aelig: "æ",
    Aacute: "Á", Agrave: "À", Acirc: "Â", Atilde: "Ã", Auml: "Ä", Aring: "Å",
    Eacute: "É", Egrave: "È", Ecirc: "Ê", Euml: "Ë",
    Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Oslash: "Ø", AElig: "Æ",
    Ccedil: "Ç", Ntilde: "Ñ", Ouml: "Ö", Uuml: "Ü",
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", mu: "μ", omega: "ω",
    micro: "µ", plusmn: "±", times: "×", divide: "÷", le: "≤", ge: "≥",
    frac12: "½", frac14: "¼", frac34: "¾", sup2: "²", sup3: "³",
    middot: "·", bull: "•", copy: "©", reg: "®", trade: "™",
    laquo: "«", raquo: "»", euro: "€", pound: "£", shy: "",
  };
  // HTML entity names are case-sensitive: &Aacute; is "Á", &aacute; is "á". A
  // blanket lowercase fallback turned every capital entity missing from the
  // table into the wrong letter. Only an ALL-CAPS name (&AMP;, &LT;, &QUOT;),
  // which browsers accept as the lowercase entity, may fall back; any other
  // unknown name is left as written rather than decoded wrongly.
  const caseInsensitiveFallback = (n: string): string | undefined =>
    n === n.toUpperCase() ? named[n.toLowerCase()] : undefined;

  // An out-of-range numeric entity (&#1114112;) makes fromCodePoint throw a
  // RangeError, which aborted extraction for the whole document. A malformed
  // entity in one paragraph must not cost the entire source, so it is left as
  // written rather than decoded.
  const codePoint = (value: number, original: string) => {
    try {
      return String.fromCodePoint(value);
    } catch {
      return original;
    }
  };

  return s
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => codePoint(parseInt(h, 16), m))
    .replace(/&#(\d+);/g, (m, d) => codePoint(Number(d), m))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, n: string) => named[n] ?? caseInsensitiveFallback(n) ?? m);

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
