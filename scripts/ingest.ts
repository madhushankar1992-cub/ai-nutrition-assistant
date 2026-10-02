// Full ingestion: scrape -> classify -> chunk -> embed -> upload to Chroma Cloud.
//
//   npm run ingest                 the whole corpus
//   npm run ingest -- --source=KEY one document
//   npm run ingest -- --dry-run    everything except the Chroma upload
//
// Run daily by .github/workflows/corpus-ingest.yml.
//
// The edition guard in step 3 can ABORT the run. That is deliberate: ingesting
// a document whose title or year no longer matches what we registered would
// leave every already-published citation pointing at text that no longer says
// what the claim says — a fabricated citation behind a working link.

import { chunkDocument, embeddingText, type Chunk } from "../lib/corpus/chunker";
import {
  deleteStaleChunks,
  ensureVectorSchema,
  storeStats,
  upsertChunks,
  upsertDocument,
} from "../lib/corpus/vectorStore";
import { embedPassages, warmUp } from "../lib/corpus/embeddings";
import { extractDocument } from "../lib/corpus/extract";
import { fetchDocument, sha256, sleep, DELAY_BETWEEN_REQUESTS_MS } from "../lib/corpus/fetcher";
import { enabledSources, getSource, type CorpusSourceDef } from "../lib/corpus/sources";
import { RETRIEVAL_CONFIG, RETRIEVAL_CONFIG_HASH } from "../lib/retrievalConfig";
import { RunLog } from "../lib/corpus/runLog";
import { randomUUID } from "node:crypto";
import { prisma } from "../lib/db";

interface DocResult {
  source: CorpusSourceDef;
  status: "ingested" | "skipped" | "aborted" | "failed";
  chunks: number;
  restricted: number;
  tables: number;
  words: number;
  detail: string;
}

function checkExpectations(source: CorpusSourceDef, title: string | null, years: number[]): string | null {
  if (source.expectTitleContains) {
    const needle = source.expectTitleContains.toLowerCase();
    if (!title || !title.toLowerCase().includes(needle)) {
      return `expected title to contain "${source.expectTitleContains}", read "${title ?? "(none)"}"`;
    }
  }
  if (source.expectYearIn?.length && !source.expectYearIn.some((y) => years.includes(y))) {
    return `expected one of ${source.expectYearIn.join("/")}, found ${years.join(", ") || "no year"}`;
  }
  return null;
}

async function ingestOne(source: CorpusSourceDef, dryRun: boolean, log: RunLog): Promise<DocResult> {
  const base = { source, chunks: 0, restricted: 0, tables: 0, words: 0 };

  if (source.acquisition === "manual") {
    log.warn("SCRAPE", "publisher blocks robots — needs a manual file", source.key);
    return { ...base, status: "skipped", detail: "publisher blocks robots — needs a manual file" };
  }

  // 1-2. Acquire + checksum
  log.info("SCRAPE", `GET ${source.fileUrl}`, source.key);
  const fetched = await fetchDocument(source.fileUrl);
  if (fetched.outcome !== "ok" || !fetched.bytes) {
    log.error("SCRAPE", `${fetched.outcome}: ${fetched.detail}`, source.key);
    return { ...base, status: "failed", detail: `${fetched.outcome}: ${fetched.detail}` };
  }
  const checksum = sha256(fetched.bytes);
  log.info("SCRAPE", `${fetched.byteLength} bytes · sha256 ${checksum.slice(0, 12)}`, source.key);

  // 4. Extract
  const extraction = await extractDocument(fetched.bytes, fetched.contentType);
  log.info("EXTRACT", `${extraction.pageCount} pages · ${extraction.wordCount} words · ${extraction.wordsPerPage}/page`, source.key);
  log.info("CLASSIFY", `artwork=[${extraction.artworkPages.join(",") || "-"}] lowText=[${extraction.lowTextPages.join(",") || "-"}] tables=[${extraction.tablePages.join(",") || "-"}]`, source.key);

  // 3. Verify — the edition guard.
  const mismatch = checkExpectations(source, extraction.title, extraction.years);
  if (mismatch) {
    log.error("VERIFY", `EDITION MISMATCH — ${mismatch}`, source.key);
    return { ...base, status: "aborted", detail: `EDITION MISMATCH — ${mismatch}` };
  }

  // 5-7. Classify + chunk. Artwork and low-text pages are dropped; table pages
  // are kept whole.
  const skipPages = [...new Set([...extraction.artworkPages, ...extraction.lowTextPages])];
  const chunks = chunkDocument(extraction, {
    skipPages,
    tablePages: extraction.tablePages,
    defaultSection: source.name,
  });

  log.info("VERIFY", `title/year OK: "${(extraction.title ?? "").slice(0, 60)}"`, source.key);
  if (!chunks.length) {
    log.error("CHUNK", "no chunks produced after classification", source.key);
    return { ...base, status: "failed", detail: "no chunks produced after classification" };
  }

  const stats = {
    chunks: chunks.length,
    restricted: chunks.filter((c) => c.restricted).length,
    tables: chunks.filter((c) => c.kind === "table").length,
    words: extraction.wordCount,
  };

  console.log(
    `    ${extraction.pageCount}p ${extraction.wordCount}w -> ${chunks.length} chunks ` +
      `(${stats.tables} table, ${stats.restricted} restricted; dropped ${skipPages.length} pages) ` +
      `checksum ${checksum.slice(0, 10)}`
  );

  // 9. Embed locally with bge-small.
  log.info("CHUNK", `${chunks.length} chunks (${stats.tables} table, ${stats.restricted} restricted; dropped ${skipPages.length} pages)`, source.key);
  const texts = chunks.map((c: Chunk) => embeddingText(c, source));
  const embeddings = await embedPassages(texts, (done, total) => {
    if (done === total || done % 128 === 0) process.stdout.write(`    embedding ${done}/${total}\r`);
  });
  process.stdout.write(" ".repeat(40) + "\r");

  log.info("EMBED", `${embeddings.length} vectors · ${RETRIEVAL_CONFIG.embeddingDimensions}d`, source.key);

  if (dryRun) {
    return { ...base, ...stats, status: "ingested", detail: "dry run — not stored" };
  }

  // 10. Store document + chunks + vectors in Postgres (pgvector).
  const documentId = await upsertDocument({
    sourceKey: source.key,
    name: source.name,
    publisher: source.publisher,
    year: source.year,
    edition: source.edition,
    url: source.url,
    fileUrl: source.fileUrl,
    checksum,
    pageCount: extraction.pageCount,
    wordCount: extraction.wordCount,
    licenseNote: source.notes,
  });
  const removed = await deleteStaleChunks(documentId, RETRIEVAL_CONFIG_HASH);
  await upsertChunks(documentId, RETRIEVAL_CONFIG_HASH, chunks, embeddings);
  log.info("STORE", `document ${documentId.slice(0, 8)} · ${chunks.length} chunks stored` + (removed ? ` · ${removed} stale removed` : ""), source.key);

  return {
    ...base, ...stats, status: "ingested",
    detail: `stored ${chunks.length} chunks` + (removed ? ` (removed ${removed} stale)` : ""),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const only = args.find((a) => a.startsWith("--source="))?.split("=")[1];

  const sources = only
    ? [getSource(only)].filter((s): s is CorpusSourceDef => Boolean(s))
    : enabledSources();

  if (only && !sources.length) {
    console.error(`No source with key "${only}".`);
    process.exit(2);
  }

  const log = new RunLog("ingest", randomUUID());
  log.info("START", `ingest · config ${RETRIEVAL_CONFIG_HASH} · ${sources.length} source(s)${dryRun ? " · DRY RUN" : ""}`);
  console.log("Corpus ingestion");
  console.log(`  config ${RETRIEVAL_CONFIG_HASH} · ${RETRIEVAL_CONFIG.embeddingModel} ` +
    `(${RETRIEVAL_CONFIG.embeddingDimensions}d) · chunk ${RETRIEVAL_CONFIG.chunkTargetTokens}/` +
    `${RETRIEVAL_CONFIG.chunkHardCapTokens}/${RETRIEVAL_CONFIG.chunkOverlapTokens}`);
  console.log(`  ${sources.length} source(s)${dryRun ? " · DRY RUN (no upload)" : ""}`);

  if (!dryRun) {
    await ensureVectorSchema();
    console.log("  pgvector schema ready");
  }

  console.log("\n  loading bge-small-en-v1.5 (first run downloads ~130 MB)...");
  const t0 = Date.now();
  await warmUp();
  console.log(`  model ready in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const results: DocResult[] = [];
  for (const [i, source] of sources.entries()) {
    console.log(`[${i + 1}/${sources.length}] ${source.name}`);
    try {
      results.push(await ingestOne(source, dryRun, log));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("ERROR", msg, source.key);
      results.push({ source, status: "failed", chunks: 0, restricted: 0, tables: 0, words: 0, detail: msg });
    }
    const last = results[results.length - 1];
    console.log(`    ${last.status.toUpperCase()}: ${last.detail}\n`);
    if (i < sources.length - 1) await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }

  console.log("=".repeat(70));
  const totals = results.reduce(
    (a, r) => ({
      chunks: a.chunks + r.chunks,
      restricted: a.restricted + r.restricted,
      tables: a.tables + r.tables,
    }),
    { chunks: 0, restricted: 0, tables: 0 }
  );
  for (const r of results) {
    console.log(`  ${r.status.padEnd(9)} ${r.chunks.toString().padStart(4)} chunks  ${r.source.name}`);
  }
  console.log("=".repeat(70));
  console.log(`  ${totals.chunks} chunks total · ${totals.tables} table · ${totals.restricted} restricted`);

  if (!dryRun) {
    const st = await storeStats();
    console.log(`  Postgres/pgvector: ${st.documents} documents · ${st.chunks} chunks · ${st.embedded} embedded`);
  }

  log.block([
    "PHASE SUMMARY",
    ...results.map((r) => `  ${r.status.padEnd(9)} ${String(r.chunks).padStart(4)} chunks  ${r.source.name}`),
    `  TOTAL ${totals.chunks} chunks · ${totals.tables} table · ${totals.restricted} restricted`,
  ].join("\n"));

  const aborted = results.filter((r) => r.status === "aborted");
  const failed = results.filter((r) => r.status === "failed");
  if (aborted.length) {
    console.error(`\nABORTED (${aborted.length}) — edition mismatch, corpus NOT updated for these:`);
    for (const r of aborted) console.error(`  · ${r.source.name}: ${r.detail}`);
  }
  if (failed.length) {
    console.error(`\nFAILED (${failed.length}):`);
    for (const r of failed) console.error(`  · ${r.source.name}: ${r.detail}`);
  }
  const ok = !aborted.length && !failed.length;
  const fin = log.finish(ok);
  console.log(`
  log written to ${fin.file}`);
  await prisma.$disconnect().catch(() => {});
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(2);
});
