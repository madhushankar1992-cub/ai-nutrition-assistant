// The daily corpus watcher.
//
// WHAT THIS DOES NOT DO: it does not update the corpus. That is deliberate.
//
// Citations are only trustworthy while the chunk a claim points at still says
// what the claim says. If a publisher swaps in a new edition and we silently
// re-ingest it, every stored citation for that document keeps its link and
// quietly stops matching its source. That is the exact failure this project
// exists to prevent (Docs/rag-architecture.md §5.4), and it is worse than a
// stale corpus because it is invisible.
//
// So the watcher detects and reports. A changed document is QUARANTINED: the
// run is marked for review, the report names what changed, and a human decides
// whether to re-ingest. The only thing that happens automatically is noticing.

import { prisma } from "@/lib/db";
import { extractDocument, LOW_TEXT_PAGE_FLOOR } from "./extract";
import { DELAY_BETWEEN_REQUESTS_MS, fetchDocument, sleep } from "./fetcher";
import { enabledSources, type CorpusSourceDef } from "./sources";

export type Verdict =
  | "first_seen"
  | "unchanged"
  | "changed"
  | "edition_mismatch"
  | "quality_drop"
  | "needs_manual_refresh"
  | "unreachable"
  | "error";

/** Verdicts that should stop a pipeline / fail a scheduled run. */
const ATTENTION: Verdict[] = ["changed", "edition_mismatch", "quality_drop", "error"];

export interface SourceReport {
  key: string;
  name: string;
  publisher: string;
  verdict: Verdict;
  detail: string;
  httpStatus: number | null;
  checksum: string | null;
  previousChecksum: string | null;
  byteLength: number;
  pageCount: number | null;
  wordCount: number | null;
  wordsPerPage: number | null;
  lowTextPages: number[];
  artworkPages: number[];
  tablePages: number[];
  extractedTitle: string | null;
  extractedYears: number[];
  durationMs: number;
}

export interface WatchReport {
  runId: string;
  startedAt: Date;
  finishedAt: Date;
  trigger: string;
  sources: SourceReport[];
  counts: Record<Verdict, number>;
  needsAttention: SourceReport[];
  ok: boolean;
}

function emptyCounts(): Record<Verdict, number> {
  return {
    first_seen: 0, unchanged: 0, changed: 0, edition_mismatch: 0,
    quality_drop: 0, needs_manual_refresh: 0, unreachable: 0, error: 0,
  };
}

/**
 * Does the fetched document still look like the document we registered?
 *
 * This is the edition guard. It is intentionally strict: corpus research found
 * two sources returning HTTP 200 while serving the wrong edition, and the only
 * thing that catches that is checking the content against a declared
 * expectation rather than trusting the URL.
 */
function checkExpectations(
  source: CorpusSourceDef,
  title: string | null,
  years: number[]
): string | null {
  if (source.expectTitleContains) {
    const needle = source.expectTitleContains.toLowerCase();
    if (!title || !title.toLowerCase().includes(needle)) {
      return `Expected the title to contain "${source.expectTitleContains}" but read "${title ?? "(none)"}"`;
    }
  }
  if (source.expectYearIn?.length) {
    const hit = source.expectYearIn.some((y) => years.includes(y));
    if (!hit) {
      return `Expected one of ${source.expectYearIn.join("/")} in the document but found ${years.length ? years.join(", ") : "no year"}`;
    }
  }
  return null;
}

async function latestSuccessfulSnapshot(sourceKey: string) {
  return prisma.corpusSnapshot.findFirst({
    where: { sourceKey, checksum: { not: null } },
    orderBy: { checkedAt: "desc" },
  });
}

async function upsertSource(source: CorpusSourceDef) {
  const data = {
    name: source.name,
    publisher: source.publisher,
    year: source.year,
    edition: source.edition ?? null,
    url: source.url,
    fileUrl: source.fileUrl,
    acquisition: source.acquisition,
    enabled: source.enabled,
    notes: source.notes ?? null,
  };
  await prisma.corpusSource.upsert({
    where: { key: source.key },
    create: { key: source.key, ...data },
    update: data,
  });
}

async function watchOne(source: CorpusSourceDef): Promise<SourceReport> {
  const previous = await latestSuccessfulSnapshot(source.key);

  const base: SourceReport = {
    key: source.key,
    name: source.name,
    publisher: source.publisher,
    verdict: "error",
    detail: "",
    httpStatus: null,
    checksum: null,
    previousChecksum: previous?.checksum ?? null,
    byteLength: 0,
    pageCount: null,
    wordCount: null,
    wordsPerPage: null,
    lowTextPages: [],
    artworkPages: [],
    tablePages: [],
    extractedTitle: null,
    extractedYears: [],
    durationMs: 0,
  };

  // Documents the publisher refuses to serve to robots are reported, never fetched.
  if (source.acquisition === "manual") {
    return {
      ...base,
      verdict: "needs_manual_refresh",
      detail: "Publisher blocks programmatic access; refresh this file by hand.",
    };
  }

  const result = await fetchDocument(source.fileUrl, {
    etag: previous?.etag ?? null,
    lastModified: previous?.lastModified ?? null,
  });

  const withFetch: SourceReport = {
    ...base,
    httpStatus: result.httpStatus,
    byteLength: result.byteLength,
    durationMs: result.durationMs,
  };

  if (result.outcome === "unchanged") {
    return { ...withFetch, verdict: "unchanged", checksum: previous?.checksum ?? null, detail: "HTTP 304 — not modified." };
  }
  if (result.outcome === "blocked") {
    return { ...withFetch, verdict: "needs_manual_refresh", detail: result.detail };
  }
  if (result.outcome === "unreachable") {
    return { ...withFetch, verdict: "unreachable", detail: result.detail };
  }
  if (result.outcome !== "ok" || !result.bytes) {
    return { ...withFetch, verdict: "error", detail: result.detail };
  }

  let extracted;
  try {
    extracted = await extractDocument(result.bytes, result.contentType);
  } catch (err) {
    return {
      ...withFetch,
      verdict: "error",
      checksum: result.checksum,
      detail: `Extraction failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const enriched: SourceReport = {
    ...withFetch,
    checksum: result.checksum,
    pageCount: extracted.pageCount,
    wordCount: extracted.wordCount,
    wordsPerPage: extracted.wordsPerPage,
    lowTextPages: extracted.lowTextPages,
    artworkPages: extracted.artworkPages,
    tablePages: extracted.tablePages,
    extractedTitle: extracted.title,
    extractedYears: extracted.years,
  };

  // The edition guard outranks everything else: a document that is no longer
  // the registered document must never be treated as a routine content change.
  const mismatch = checkExpectations(source, extracted.title, extracted.years);
  if (mismatch) {
    return { ...enriched, verdict: "edition_mismatch", detail: mismatch };
  }

  if (extracted.wordCount === 0) {
    return {
      ...enriched,
      verdict: "quality_drop",
      detail: "Fetched successfully but no text could be extracted.",
    };
  }

  // A sudden collapse in extractable text usually means the publisher replaced
  // prose with an image-only PDF, which would poison the index silently.
  if (previous?.wordCount && extracted.wordCount < previous.wordCount * 0.5) {
    return {
      ...enriched,
      verdict: "quality_drop",
      detail: `Word count fell from ${previous.wordCount} to ${extracted.wordCount} (>50% drop).`,
    };
  }

  if (!previous?.checksum) {
    return {
      ...enriched,
      verdict: "first_seen",
      detail: `Baseline recorded: ${extracted.pageCount} pages, ${extracted.wordCount} words (${extracted.wordsPerPage}/page).`,
    };
  }
  if (previous.checksum === result.checksum) {
    return { ...enriched, verdict: "unchanged", detail: "Checksum matches the last snapshot." };
  }

  const wordDelta = extracted.wordCount - (previous.wordCount ?? 0);
  return {
    ...enriched,
    verdict: "changed",
    detail:
      `Content changed (checksum ${previous.checksum.slice(0, 12)} -> ${result.checksum!.slice(0, 12)}; ` +
      `words ${previous.wordCount ?? "?"} -> ${extracted.wordCount}, ${wordDelta >= 0 ? "+" : ""}${wordDelta}). ` +
      `Quarantined: review before re-ingesting.`,
  };
}

async function persistSnapshot(runId: string, r: SourceReport, fetchMeta: { etag?: string | null; lastModified?: string | null; contentType?: string | null; finalUrl?: string | null }) {
  await prisma.corpusSnapshot.create({
    data: {
      sourceKey: r.key,
      runId,
      verdict: r.verdict,
      detail: r.detail,
      httpStatus: r.httpStatus,
      contentType: fetchMeta.contentType ?? null,
      finalUrl: fetchMeta.finalUrl ?? null,
      byteLength: r.byteLength || null,
      checksum: r.checksum,
      etag: fetchMeta.etag ?? null,
      lastModified: fetchMeta.lastModified ?? null,
      pageCount: r.pageCount,
      wordCount: r.wordCount,
      wordsPerPage: r.wordsPerPage,
      lowTextPages: JSON.stringify(r.lowTextPages),
      artworkPages: JSON.stringify(r.artworkPages),
      tablePages: JSON.stringify(r.tablePages),
      extractedTitle: r.extractedTitle,
      extractedYears: JSON.stringify(r.extractedYears),
    },
  });
}

export async function runWatch(trigger: string = "manual"): Promise<WatchReport> {
  const startedAt = new Date();
  const run = await prisma.scrapeRun.create({ data: { trigger } });
  const sources = enabledSources();
  const reports: SourceReport[] = [];

  for (const [i, source] of sources.entries()) {
    await upsertSource(source);

    // Re-fetch conditional headers so they can be stored with the snapshot.
    const previous = await latestSuccessfulSnapshot(source.key);
    const report = await watchOne(source);
    reports.push(report);

    await persistSnapshot(run.id, report, {
      etag: report.verdict === "unchanged" ? previous?.etag : undefined,
      lastModified: report.verdict === "unchanged" ? previous?.lastModified : undefined,
    });

    if (i < sources.length - 1) await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }

  const counts = emptyCounts();
  for (const r of reports) counts[r.verdict] += 1;
  const needsAttention = reports.filter((r) => ATTENTION.includes(r.verdict));
  const finishedAt = new Date();

  await prisma.scrapeRun.update({
    where: { id: run.id },
    data: {
      finishedAt,
      sourcesChecked: reports.length,
      changed: counts.changed + counts.edition_mismatch + counts.quality_drop,
      blocked: counts.needs_manual_refresh,
      failed: counts.error + counts.unreachable,
      ok: needsAttention.length === 0,
      summary: Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(" "),
    },
  });

  return {
    runId: run.id,
    startedAt,
    finishedAt,
    trigger,
    sources: reports,
    counts,
    needsAttention,
    ok: needsAttention.length === 0,
  };
}

export function formatReport(report: WatchReport): string {
  const icon: Record<Verdict, string> = {
    unchanged: "  ok  ", first_seen: " new  ", changed: " CHG  ",
    edition_mismatch: "EDITION", quality_drop: "QUALITY",
    needs_manual_refresh: "manual", unreachable: " net  ", error: "ERROR ",
  };
  const lines: string[] = [];
  lines.push(`Corpus watch — ${report.startedAt.toISOString()} (trigger: ${report.trigger})`);
  lines.push("=".repeat(78));
  for (const r of report.sources) {
    lines.push(`[${icon[r.verdict]}] ${r.name}`);
    lines.push(`          ${r.publisher} · ${r.detail}`);
    if (r.wordCount != null) {
      lines.push(`          ${r.pageCount} pages · ${r.wordCount} words · ${r.wordsPerPage}/page` +
        (r.lowTextPages.length ? ` · low-text pages: ${r.lowTextPages.join(", ")} (<${LOW_TEXT_PAGE_FLOOR} words)` : "") +
        (r.artworkPages.length ? ` · artwork pages: ${r.artworkPages.join(", ")}` : "") +
        (r.tablePages.length ? ` · table pages: ${r.tablePages.length}` : ""));
    }
  }
  lines.push("=".repeat(78));
  lines.push(Object.entries(report.counts).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`).join("   "));
  if (report.needsAttention.length) {
    lines.push("");
    lines.push(`NEEDS REVIEW (${report.needsAttention.length}) — corpus NOT updated automatically:`);
    for (const r of report.needsAttention) lines.push(`  · ${r.name} — ${r.verdict}: ${r.detail}`);
  }
  return lines.join("\n");
}
