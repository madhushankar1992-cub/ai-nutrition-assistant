// Inspect what is actually in the vector store.
//
//   npm run vectors                      overview + sample chunks with vectors
//   npm run vectors -- --chunks=5        how many samples to show
//   npm run vectors -- --dims=12         how many vector components to print
//   npm run vectors -- --query="..."     run a live search and show the ranking
//
// Prints the real embedding values, not a summary of them: the point is to be
// able to see that a vector exists, has the right dimensionality, and is
// normalised (‖v‖ ≈ 1, which is what makes cosine distance a dot product).

import { prisma } from "../lib/db";
import { embedQuery, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../lib/corpus/embeddings";
import { retrieve } from "../lib/retrieval";
import { RETRIEVAL_CONFIG, RETRIEVAL_CONFIG_HASH } from "../lib/retrievalConfig";

const arg = (name: string, fallback: string) =>
  process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;

const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
const fmt = (v: number[], n: number) =>
  "[" + v.slice(0, n).map((x) => x.toFixed(4).padStart(7)).join(", ") + (v.length > n ? ", …" : "") + "]";

async function main() {
  const sampleCount = Number(arg("chunks", "3"));
  const dims = Number(arg("dims", "10"));
  const query = arg("query", "");

  console.log("=".repeat(76));
  console.log("VECTOR STORE INSPECTION");
  console.log("=".repeat(76));
  console.log(`  store         pgvector (Postgres)`);
  console.log(`  model         ${EMBEDDING_MODEL}`);
  console.log(`  dimensions    ${EMBEDDING_DIMENSIONS}`);
  console.log(`  config hash   ${RETRIEVAL_CONFIG_HASH}`);
  console.log(`  k             ${RETRIEVAL_CONFIG.k}`);

  const [ext] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT extversion FROM pg_extension WHERE extname='vector'`
  );
  const [idx] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT indexname FROM pg_indexes WHERE indexname='chunk_embedding_cosine_idx'`
  );
  console.log(`  pgvector      ${ext?.extversion ?? "NOT INSTALLED"}`);
  console.log(`  index         ${idx?.indexname ?? "none"}`);

  // --- contents by document ------------------------------------------------
  const perDoc = await prisma.$queryRawUnsafe<any[]>(`
    SELECT d.name, d.publisher, d.year,
           COUNT(c.id)::int AS chunks,
           COUNT(c.embedding)::int AS embedded,
           SUM(CASE WHEN c.restricted THEN 1 ELSE 0 END)::int AS restricted,
           SUM(CASE WHEN c.kind='table' THEN 1 ELSE 0 END)::int AS tables
    FROM "Document" d LEFT JOIN "Chunk" c ON c."documentId" = d.id
    GROUP BY d.name, d.publisher, d.year
    ORDER BY chunks DESC`);

  console.log("\n" + "-".repeat(76));
  console.log("CONTENTS");
  console.log("-".repeat(76));
  console.log("chunks  emb  tbl  restr  document");
  for (const d of perDoc) {
    console.log(
      `${String(d.chunks).padStart(6)} ${String(d.embedded).padStart(4)} ` +
        `${String(d.tables).padStart(4)} ${String(d.restricted).padStart(6)}  ` +
        `${d.name.slice(0, 44)} — ${d.publisher.slice(0, 22)} ${d.year}`
    );
  }
  const [tot] = await prisma.$queryRawUnsafe<any[]>(
    `SELECT COUNT(*)::int n, COUNT(embedding)::int e FROM "Chunk"`
  );
  console.log(`\n  TOTAL ${tot.n} chunks · ${tot.e} embedded` + (tot.n !== tot.e ? "  ⚠ some chunks have no vector" : ""));

  // --- sample chunks WITH their vectors ------------------------------------
  console.log("\n" + "-".repeat(76));
  console.log(`SAMPLE CHUNKS WITH EMBEDDINGS (first ${dims} of ${EMBEDDING_DIMENSIONS} components)`);
  console.log("-".repeat(76));

  const samples = await prisma.$queryRawUnsafe<any[]>(`
    SELECT c.id, c.section, c.page, c.kind, c.restricted, c."tokenCount",
           substring(c.text, 1, 150) AS snippet,
           c.embedding::text AS vec,
           d.name AS doc, d.publisher, d.year
    FROM "Chunk" c JOIN "Document" d ON d.id = c."documentId"
    WHERE c.embedding IS NOT NULL
    ORDER BY c."tokenCount" DESC
    LIMIT ${sampleCount}`);

  for (const [i, s] of samples.entries()) {
    const vector: number[] = JSON.parse(s.vec);
    console.log(`\n[${i + 1}] ${s.doc} — ${s.publisher} ${s.year}`);
    console.log(`    chunkId   ${s.id}`);
    console.log(`    section   ${String(s.section).slice(0, 58)}`);
    console.log(`    page ${s.page} · ${s.kind} · ${s.tokenCount} tokens` + (s.restricted ? " · RESTRICTED" : ""));
    console.log(`    text      "${String(s.snippet).replace(/\s+/g, " ").trim()}…"`);
    console.log(`    dims      ${vector.length}`);
    console.log(`    ‖v‖       ${norm(vector).toFixed(6)}  (≈1.0 means normalised)`);
    console.log(`    vector    ${fmt(vector, dims)}`);
  }

  // --- live search ---------------------------------------------------------
  if (query) {
    console.log("\n" + "-".repeat(76));
    console.log(`LIVE SEARCH — "${query}"`);
    console.log("-".repeat(76));

    const qv = await embedQuery(query);
    console.log(`  query vector  dims=${qv.length}  ‖v‖=${norm(qv).toFixed(6)}`);
    console.log(`  components    ${fmt(qv, dims)}\n`);

    const result = await retrieve(query);
    console.log(`  sufficient: ${result.sufficient}  (${result.reason})\n`);
    console.log("  rank  final  vector  lexical  source");
    for (const [i, c] of result.chunks.entries()) {
      console.log(
        `  ${String(i + 1).padStart(4)}  ${c.score.toFixed(3)}  ${c.vectorScore.toFixed(3)}` +
          `   ${c.lexicalScore.toFixed(3)}   ${c.publisher.slice(0, 26)} ${c.year} §${String(c.section).slice(0, 26)}`
      );
      console.log(`        "${c.text.replace(/\s+/g, " ").slice(0, 96)}…"`);
    }
  }

  console.log("\n" + "=".repeat(76));
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Inspection failed:", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
