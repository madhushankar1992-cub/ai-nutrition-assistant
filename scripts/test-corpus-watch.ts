// Offline watcher regression checks: the real fetch/extraction/watch pipeline,
// with HTTP and persistence replaced so no database or network is contacted.
import assert from "node:assert/strict";
import { prisma } from "../lib/db";
import { CORPUS_SOURCES } from "../lib/corpus/sources";
import { runWatch } from "../lib/corpus/watcher";

async function main() {
  const source = CORPUS_SOURCES[0];
  const enabled = CORPUS_SOURCES.map((s) => s.enabled);
  const originalFetch = globalThis.fetch;
  const restores: (() => void)[] = [];
  function replace(target: object, key: string, value: unknown) {
    const object = target as Record<string, unknown>;
    const original = object[key];
    object[key] = value;
    restores.push(() => { object[key] = original; });
  }
  const baseline = {
    sourceKey: source.key, verdict: "first_seen", checksum: "baseline-checksum",
    etag: '"baseline"', lastModified: "Thu, 01 Oct 2026 00:00:00 GMT",
    byteLength: 800, pageCount: 3, wordCount: 100, wordsPerPage: 33,
    lowTextPages: "[2]", artworkPages: "[3]", tablePages: "[1]",
    extractedTitle: "Healthy diet", extractedYears: "[2026]",
  };
  const snapshots: Record<string, unknown>[] = [baseline];
  let requests = 0;
  let response: () => Response = () => new Response(null, { status: 304 });
  try {
    CORPUS_SOURCES.forEach((s) => { s.enabled = s === source; });
    replace(prisma.corpusSource, "upsert", async () => ({}));
    replace(prisma.scrapeRun, "create", async () => ({ id: "offline-run" }));
    replace(prisma.scrapeRun, "update", async () => ({}));
    replace(prisma.corpusSnapshot, "findFirst", async (args: {
      where: { sourceKey: string; checksum: { not: null }; verdict: { in: string[] } };
    }) => {
      assert.equal(args.where.sourceKey, source.key);
      assert.deepEqual(args.where.checksum, { not: null });
      assert.deepEqual(args.where.verdict.in, ["first_seen", "unchanged"]);
      return [...snapshots].reverse().find((s) =>
        s.checksum && args.where.verdict.in.includes(String(s.verdict))) ?? null;
    });
    replace(prisma.corpusSnapshot, "create", async ({ data }: { data: Record<string, unknown> }) => {
      snapshots.push(data);
      return data;
    });
    globalThis.fetch = async (_input, init) => {
      requests++;
      assert.equal(new Headers(init?.headers).get("if-none-match"), '"baseline"');
      return response();
    };

    const unchanged = await runWatch("offline-test");
    assert.equal(unchanged.sources[0].verdict, "unchanged");
    const persisted = snapshots[snapshots.length - 1];
    for (const key of ["checksum", "byteLength", "pageCount", "wordCount", "wordsPerPage",
      "lowTextPages", "artworkPages", "tablePages", "extractedTitle", "extractedYears", "etag", "lastModified"] as const) {
      assert.deepEqual(persisted[key], baseline[key], `304 must preserve ${key}`);
    }

    // A newly downloaded edition has no cache validators. The old validators
    // belong to the baseline bytes and must not be assigned to this response.
    response = () => new Response(
      "<html><head><title>Unrelated new edition</title></head><body><main>" +
      "<h1>Unrelated new edition</h1><p>New guidance published in 2026.</p>" +
      "</main></body></html>",
      { status: 200, headers: { "content-type": "text/html" } }
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      const mismatch = await runWatch("offline-test");
      assert.equal(mismatch.sources[0].verdict, "edition_mismatch");
      assert.equal(mismatch.ok, false);
      assert.equal(mismatch.needsAttention.length, 1);
      assert.equal(snapshots[snapshots.length - 1].etag, null);
      assert.equal(snapshots[snapshots.length - 1].lastModified, null);
    }
    assert.equal(requests, 3);
    console.log("PASS: corpus watcher baselines, 304 metadata, validators, and repeated edition mismatch");
  } finally {
    globalThis.fetch = originalFetch;
    CORPUS_SOURCES.forEach((s, i) => { s.enabled = enabled[i]; });
    restores.reverse().forEach((restore) => restore());
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
