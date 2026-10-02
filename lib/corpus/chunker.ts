// Heading-aware chunking.
//
// A chunk is both the unit of RETRIEVAL and the unit of CITATION, and those
// pull in opposite directions: retrieval wants small chunks so one vector means
// one idea, citation wants large ones so a claim can be checked against the
// passage. Everything here is a trade between the two.
//
// The rules, each with the failure it prevents:
//   1. Split on headings first      - keeps "eat leftovers within" attached to "48 hours"
//   2. Never split a detected table - half a table cites a number whose column
//                                     header is in a different chunk
//   3. Overlap only WITHIN a section - overlapping across a heading would make
//                                      the same text belong to two sections
//   4. Carry the heading onto every piece - the reader lands in the right place

import { HTML_HEADING_MARKER, type ExtractedPage, type ExtractionResult } from "./extract";

export const CHUNK_TARGET_TOKENS = 500;
export const CHUNK_HARD_CAP_TOKENS = 900;
export const CHUNK_OVERLAP_TOKENS = 80;
export const MIN_CHUNK_TOKENS = 120;

export type ChunkKind = "prose" | "table" | "references" | "toc";

// --- Non-answering chunks --------------------------------------------------
// A reference list and a table of contents are made of the same words as the
// chapters they point at, so they match those chapters' questions — but they
// can never answer one. Measured: on "What is the dietary fibre reference value
// for adults?" three EFSA *bibliography* chunks took ranks 2-4, pushing out the
// passage that states 25 g/day. The contents page did the same for vitamin C.
//
// Both thresholds below are measured against the real corpus, not guessed. The
// separation is wide, which is why a plain threshold is enough:
//   citations per 100 words — 6 reference chunks score 4.8-12.6, everything
//                             else in the corpus scores <= 1.8
//   dot leaders per 100 words — 5 contents chunks score 7.7-31.1, every other
//                             chunk scores exactly 0
const DOT_LEADER = /\.{4,}/g;
const CITATION =
  /(\bdoi\b|doi\.org|\bet al\b|EFSA Journal|\bpp\.|\bvol\.|\bISBN\b|https?:\/\/|\b\d{4};\s?\d+|\(\d{4}\)|\b\d{4}\.\s)/gi;

/** Citations per 100 words above which a chunk is a bibliography. */
export const REFERENCES_CITATION_DENSITY = 3.0;
/** Dot leaders per 100 words above which a chunk is a contents listing. */
export const TOC_LEADER_DENSITY = 1.0;

export function classifyNonProse(text: string): "references" | "toc" | null {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  if (words < 20) return null;

  const leaders = ((text.match(DOT_LEADER) ?? []).length / words) * 100;
  if (leaders >= TOC_LEADER_DENSITY) return "toc";

  const citations = ((text.match(CITATION) ?? []).length / words) * 100;
  if (citations >= REFERENCES_CITATION_DENSITY) return "references";

  return null;
}

export interface Chunk {
  ordinal: number;
  section: string;
  /** "outline" | "numbered" | "typographic" | "inherited" — citation precision signal. */
  sectionConfidence: string;
  page: number;
  text: string;
  tokenCount: number;
  kind: ChunkKind;
  oversized: boolean;
  restricted: boolean;
}

/**
 * ~4 characters per token. Deliberately the same heuristic lib/rateLimiter.ts
 * uses, so chunk budgeting and request budgeting cannot drift apart.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// --- Restricted content ----------------------------------------------------
// The corpus itself contains the material the assistant must refuse. This is
// NOT a per-document special case: it was first assumed to be a DGA-only
// problem, but EFSA — the densest document in the corpus — states protein as
// "0.8 to 1.25 g/kg body weight per day", because that is how nutrition science
// expresses intakes. So the scan runs corpus-wide.
const RESTRICTED_PATTERNS: RegExp[] = [
  /\bper\s+(kilogram|kg)\b[^.]{0,40}\bbody\s*weight\b/i,
  /\bg\s*\/\s*kg\b[^.]{0,40}\bbody\s*weight\b/i,
  /\b\d{3,4}\s*(kcal|calorie|calories)\b[^.]{0,40}\b(per\s+day|daily|pattern|intake|requirement)\b/i,
  /\bcalorie\s+(target|goal|requirement|pattern|allowance)\b/i,
  /\b\d{3,4}\s*-\s*calorie\b/i,
];

export function isRestricted(text: string): boolean {
  return RESTRICTED_PATTERNS.some((re) => re.test(text));
}

// --- Section detection -----------------------------------------------------

const NUMBERED_HEADING = /^(\d+(?:\.\d+)*)\s+([A-Z].{2,70})$/;
const TABLE_CAPTION = /^(Table|Figure|Annex|Appendix)\s+\d+\s*[:.]?\s*(.{0,80})$/i;

/** List markers — a bullet is body text, never a section heading. */
const LIST_MARKER = /^\s*([+\-*•·●▪]|\(?\d+[.)])\s+/;

/**
 * Words a real heading does not end on. A line ending in a preposition or
 * conjunction is a wrapped sentence, not a title — "Instead, prioritize
 * nutrient-dense foods and" was being promoted to a section heading.
 */
const CONTINUATION_TAIL =
  /\b(and|or|but|the|a|an|to|of|in|on|for|with|about|from|by|as|at|that|than|into|over|your|their|its)$/i;

function looksTypographic(line: string): boolean {
  const s = line.trim();
  if (s.length < 4 || s.length > 70) return false;
  if (/[.;,:]$/.test(s)) return false;
  if (LIST_MARKER.test(s)) return false;
  if (CONTINUATION_TAIL.test(s)) return false;

  const words = s.split(/\s+/);
  if (words.length > 10) return false;
  if (!/^[A-Z]/.test(s)) return false;

  // ALL CAPS is unambiguous. Otherwise require Title Case across most words,
  // which separates "Consume Dairy" from "Talk with your health care professional".
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length > 2 && letters === letters.toUpperCase()) return true;

  const significant = words.filter((w) => w.length > 3);
  if (!significant.length) return false;
  const capitalised = significant.filter((w) => /^[A-Z]/.test(w)).length;
  return capitalised / significant.length >= 0.6;
}

/**
 * Strip running headers and footers.
 *
 * Every page of the US guidelines carries "Dietary Guidelines for Americans,
 * 2025-2030 | 4". Those lines pass every heading test, so without this each
 * page boundary became a fake section and the document shattered into 27
 * fragments averaging 148 tokens against a 500 target.
 *
 * Boilerplate is identified by repetition: a short line appearing on more than
 * half the pages is furniture, not content.
 */
function findBoilerplate(pages: ExtractedPage[]): Set<string> {
  if (pages.length < 3) return new Set();

  const seenOnPages = new Map<string, Set<number>>();
  for (const page of pages) {
    for (const raw of page.text.split("\n")) {
      const line = raw.trim();
      if (!line || line.length > 90) continue;
      // Page numbers vary, so compare with digits removed.
      const normalised = line.replace(/\d+/g, "#");
      if (!seenOnPages.has(normalised)) seenOnPages.set(normalised, new Set());
      seenOnPages.get(normalised)!.add(page.pageNumber);
    }
  }

  const threshold = Math.max(3, Math.ceil(pages.length * 0.5));
  const boilerplate = new Set<string>();
  for (const [normalised, pageSet] of seenOnPages) {
    if (pageSet.size >= threshold) boilerplate.add(normalised);
  }
  return boilerplate;
}

const normaliseLine = (line: string) => line.trim().replace(/\d+/g, "#");

interface DetectedHeading {
  text: string;
  confidence: string;
}

function detectHeading(line: string): DetectedHeading | null {
  const s = line.trim();
  if (!s) return null;

  // An HTML source states its own headings; never second-guess the markup.
  if (s.startsWith(HTML_HEADING_MARKER.trim())) {
    const text = s.slice(HTML_HEADING_MARKER.trim().length).trim();
    return text ? { text, confidence: "outline" } : null;
  }

  const numbered = s.match(NUMBERED_HEADING);
  if (numbered) return { text: s, confidence: "numbered" };

  const caption = s.match(TABLE_CAPTION);
  if (caption) return { text: s, confidence: "numbered" };

  if (looksTypographic(s)) return { text: s, confidence: "typographic" };

  return null;
}

// --- Splitting -------------------------------------------------------------

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Split an over-cap section on paragraph boundaries, with overlap. */
function splitLongSection(paragraphs: string[], target: number): string[] {
  const pieces: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  const flush = () => {
    if (!current.length) return;
    pieces.push(current.join("\n\n"));
    current = [];
    currentTokens = 0;
  };

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);

    // A single paragraph larger than the cap is split on sentence boundaries;
    // otherwise it would blow past the cap on its own.
    if (paraTokens > CHUNK_HARD_CAP_TOKENS) {
      flush();
      const sentences = para.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [para];
      let buf: string[] = [];
      let bufTokens = 0;
      for (const sentence of sentences) {
        const t = estimateTokens(sentence);
        if (bufTokens + t > target && buf.length) {
          pieces.push(buf.join("").trim());
          buf = [];
          bufTokens = 0;
        }
        buf.push(sentence);
        bufTokens += t;
      }
      if (buf.length) pieces.push(buf.join("").trim());
      continue;
    }

    if (currentTokens + paraTokens > target && current.length) {
      flush();
      // Overlap: carry the tail of the previous piece into the next one, so a
      // sentence straddling the boundary survives in at least one chunk.
      const previous = pieces[pieces.length - 1];
      if (previous) {
        const tail = previous.slice(-CHUNK_OVERLAP_TOKENS * 4);
        const cut = tail.indexOf(" ");
        current.push(cut > 0 ? tail.slice(cut + 1) : tail);
        currentTokens = estimateTokens(current[0]);
      }
    }

    current.push(para);
    currentTokens += paraTokens;
  }
  flush();

  // Fold a runt tail into its predecessor: a 30-token orphan retrieves on noise.
  if (pieces.length > 1) {
    const last = pieces[pieces.length - 1];
    if (estimateTokens(last) < MIN_CHUNK_TOKENS) {
      pieces[pieces.length - 2] += "\n\n" + last;
      pieces.pop();
    }
  }
  return pieces;
}

// --- Main ------------------------------------------------------------------

export interface ChunkOptions {
  /** Pages dropped before chunking — artwork and low-text covers. */
  skipPages?: number[];
  /** Pages kept whole as a single chunk. */
  tablePages?: number[];
  /** Section used before the first heading is seen. */
  defaultSection?: string;
  /**
   * Override the chunk target. HTML sources need a smaller one.
   *
   * A PDF gives page breaks, which act as natural topic boundaries. An HTML
   * page is one continuous run, so a 500-token chunk there routinely spans
   * several unrelated topics — measured: the FSA guidance produced 757-token
   * chunks covering fridge settings, freezer burn and leftovers at once. Every
   * such chunk then contains every query term, which destroys ranking: the
   * right passage cannot outscore the wrong one on either vector or keyword.
   */
  targetTokens?: number;
}

/** HTML has no page breaks to chunk on, so it needs a tighter target. */
export const HTML_CHUNK_TARGET_TOKENS = 220;

export function chunkDocument(
  extraction: ExtractionResult,
  options: ChunkOptions = {}
): Chunk[] {
  const skip = new Set(options.skipPages ?? []);
  const tables = new Set(options.tablePages ?? []);
  const chunks: Chunk[] = [];

  const boilerplate = findBoilerplate(extraction.pages as ExtractedPage[]);
  const target =
    options.targetTokens ??
    (extraction.kind === "html" ? HTML_CHUNK_TARGET_TOKENS : CHUNK_TARGET_TOKENS);

  let section = options.defaultSection ?? "Introduction";
  let sectionConfidence = "inherited";
  let buffer: string[] = [];
  let bufferPage = 1;

  // Measure the buffer AFTER whitespace normalisation, because that is what the
  // emitted chunk contains. Measuring the raw buffer over-counted badly on HTML
  // sources — indentation and blank lines inflated the estimate, so a "130
  // token" buffer became a 40-token chunk and 19% of chunks landed under the
  // minimum. Normalising first makes the guard measure the same thing it guards.
  const bufferTokens = () => estimateTokens(splitIntoParagraphs(buffer.join("\n")).join("\n\n"));

  // A heading line stays in the buffer when the section before it was too short
  // to close (see below), so the marker has to come off the emitted text.
  const stripMarkers = (s: string) =>
    s.split("\n").map((l) => l.replace(HTML_HEADING_MARKER.trim() + " ", "")).join("\n");

  const flushBuffer = () => {
    const text = stripMarkers(buffer.join("\n")).trim();
    buffer = [];
    if (!text) return;

    const paragraphs = splitIntoParagraphs(text);
    if (!paragraphs.length) return;

    const total = estimateTokens(text);
    // Split once the section exceeds its target, not only at the hard cap —
    // otherwise an HTML section of 700 tokens stayed whole despite a 220 target.
    const pieces =
      total <= Math.max(target, MIN_CHUNK_TOKENS * 2)
        ? [paragraphs.join("\n\n")]
        : splitLongSection(paragraphs, target);

    // Merge runt pieces forward rather than emitting them: a 40-token chunk
    // retrieves on noise and cannot carry a checkable claim.
    const merged: string[] = [];
    for (const piece of pieces) {
      const prev = merged[merged.length - 1];
      if (prev && estimateTokens(prev) < MIN_CHUNK_TOKENS) {
        merged[merged.length - 1] = prev + "\n\n" + piece;
      } else {
        merged.push(piece);
      }
    }

    for (const piece of merged) {
      const tokenCount = estimateTokens(piece);
      if (tokenCount < 20) continue;
      chunks.push({
        ordinal: chunks.length,
        section,
        sectionConfidence,
        page: bufferPage,
        text: piece,
        tokenCount,
        kind: classifyNonProse(piece) ?? "prose",
        oversized: tokenCount > CHUNK_HARD_CAP_TOKENS,
        restricted: isRestricted(piece),
      });
    }
  };

  for (const page of extraction.pages as ExtractedPage[]) {
    if (skip.has(page.pageNumber)) continue;

    // Rule 2: a table page becomes exactly one chunk, over-cap if necessary.
    if (tables.has(page.pageNumber)) {
      flushBuffer();
      const text = page.text.replace(/[ \t]+/g, " ").trim();
      if (text) {
        const tokenCount = estimateTokens(text);
        const caption = page.text.split("\n").map((l) => l.trim()).find((l) => TABLE_CAPTION.test(l));
        chunks.push({
          ordinal: chunks.length,
          section: caption ?? section,
          sectionConfidence: caption ? "numbered" : sectionConfidence,
          page: page.pageNumber,
          text,
          tokenCount,
          // A contents page is dense with digits and short on sentences, so it
          // can reach this branch by looking like a table. Check it here too.
          kind: classifyNonProse(text) ?? "table",
          oversized: tokenCount > CHUNK_HARD_CAP_TOKENS,
          restricted: isRestricted(text),
        });
      }
      continue;
    }

    if (!buffer.length) bufferPage = page.pageNumber;

    for (const rawLine of page.text.split("\n")) {
      // Running headers and footers are furniture, not content or headings.
      if (boilerplate.has(normaliseLine(rawLine))) continue;

      const heading = detectHeading(rawLine);
      if (heading) {
        // Rule 1 + 3: a heading closes the previous section, and overlap never
        // crosses this boundary because the buffer is flushed here.
        //
        // But only when there is enough accumulated text to be worth closing.
        // Heading detection on a PDF is heuristic, so a run of false positives
        // would otherwise shatter the document into unusably small chunks. If
        // the buffer is still below the minimum, treat the line as body text.
        if (!buffer.length) {
          section = heading.text;
          sectionConfidence = heading.confidence;
          bufferPage = page.pageNumber;
          continue;
        }
        if (bufferTokens() >= MIN_CHUNK_TOKENS) {
          flushBuffer();
          section = heading.text;
          sectionConfidence = heading.confidence;
          bufferPage = page.pageNumber;
          continue;
        }
      }
      buffer.push(rawLine);
    }
  }
  flushBuffer();

  return chunks.map((c, i) => ({ ...c, ordinal: i }));
}

/** The string actually embedded: provenance prefix + passage text. */
export function embeddingText(
  chunk: Chunk,
  doc: { publisher: string; year: number }
): string {
  return `[${doc.publisher} · ${doc.year} · ${chunk.section}]\n${chunk.text}`;
}
