// Corpus watcher entry point.
//
//   npm run corpus:watch              check every enabled source, write a report
//   npm run corpus:watch -- --dry-run fetch and report, write nothing to the DB
//
// Run on a schedule by .github/workflows/corpus-watch.yml. Exits non-zero when
// a document changed, so the workflow fails loudly and opens an issue rather
// than letting a silent edition swap through.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/db";
import { formatReport, runWatch, type WatchReport } from "../lib/corpus/watcher";
import { enabledSources } from "../lib/corpus/sources";

const REPORT_PATH = path.join("Docs", "corpus-watch-report.md");

function markdownReport(report: WatchReport): string {
  const rows = report.sources.map((r) => {
    const size = r.wordCount != null ? `${r.pageCount} pp · ${r.wordCount} words` : "—";
    return `| ${r.name} | ${r.publisher} | \`${r.verdict}\` | ${size} | ${r.detail.replace(/\|/g, "\\|")} |`;
  });

  const lines = [
    "# Corpus Watch Report",
    "",
    `Run \`${report.runId}\` · trigger \`${report.trigger}\` · ${report.startedAt.toISOString()}`,
    `Duration ${Math.round((report.finishedAt.getTime() - report.startedAt.getTime()) / 1000)}s · ` +
      `${report.sources.length} sources checked`,
    "",
    report.ok
      ? "**No action needed.** Every source is unchanged, or blocked in the way we already expect."
      : `**${report.needsAttention.length} source(s) need review.** The corpus was NOT updated automatically — see below.`,
    "",
    "## Results",
    "",
    "| Document | Publisher | Verdict | Size | Detail |",
    "|---|---|---|---|---|",
    ...rows,
    "",
    "## Counts",
    "",
    "| Verdict | Count |",
    "|---|---|",
    ...Object.entries(report.counts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `| \`${k}\` | ${n} |`),
  ];

  if (report.needsAttention.length) {
    lines.push(
      "",
      "## Needs review",
      "",
      "A changed document is quarantined, never auto-ingested: re-ingesting silently would leave",
      "existing citations pointing at text that no longer says what the claim says.",
      ""
    );
    for (const r of report.needsAttention) {
      lines.push(`### ${r.name}`, "", `- **Verdict:** \`${r.verdict}\``, `- **Detail:** ${r.detail}`);
      if (r.previousChecksum && r.checksum) {
        lines.push(`- **Checksum:** \`${r.previousChecksum.slice(0, 16)}\` → \`${r.checksum.slice(0, 16)}\``);
      }
      if (r.extractedTitle) lines.push(`- **Title read from the file:** ${r.extractedTitle}`);
      if (r.extractedYears.length) lines.push(`- **Years found:** ${r.extractedYears.join(", ")}`);
      lines.push("");
    }
    lines.push(
      "**What to do:** open the document, confirm whether it is a new edition or a minor revision,",
      "update `lib/corpus/sources.ts` (year, edition, expectations) if it really changed, then re-run",
      "ingestion deliberately and re-check the citation spot-check sample."
    );
  }

  return lines.join("\n") + "\n";
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const trigger = (args.find((a) => a.startsWith("--trigger="))?.split("=")[1] ?? "manual").trim();

  console.log(`Corpus watch starting — ${enabledSources().length} enabled sources, trigger="${trigger}"`);
  if (dryRun) console.log("(dry run: no database writes, no report file)\n");

  if (dryRun) {
    // Exercise fetch + extract without touching the DB, so the pipeline can be
    // checked against a database that has not been migrated yet.
    const { fetchDocument } = await import("../lib/corpus/fetcher");
    const { extractDocument } = await import("../lib/corpus/extract");
    let failures = 0;
    for (const s of enabledSources()) {
      if (s.acquisition === "manual") {
        console.log(`[manual] ${s.name} — publisher blocks robots; refresh by hand`);
        continue;
      }
      const res = await fetchDocument(s.fileUrl);
      if (res.outcome !== "ok" || !res.bytes) {
        console.log(`[${res.outcome}] ${s.name} — ${res.detail}`);
        if (res.outcome === "error") failures++;
        continue;
      }
      const ex = await extractDocument(res.bytes, res.contentType);
      console.log(
        `[ok]     ${s.name} — ${ex.pageCount} pp, ${ex.wordCount} words (${ex.wordsPerPage}/page)` +
          (ex.lowTextPages.length ? `, low-text: ${ex.lowTextPages.join(",")}` : "") +
          (ex.artworkPages.length ? `, ARTWORK: ${ex.artworkPages.join(",")}` : "") +
          (ex.tablePages.length ? `, tables: ${ex.tablePages.length}p` : "") +
          `\n         title: ${ex.title?.slice(0, 90) ?? "(none)"}`
      );
    }
    process.exit(failures > 0 ? 1 : 0);
  }

  const report = await runWatch(trigger);
  console.log("\n" + formatReport(report) + "\n");

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, markdownReport(report), "utf8");
  console.log(`Report written to ${REPORT_PATH}`);

  await prisma.$disconnect();

  // Non-zero tells the scheduler something needs a human.
  process.exit(report.ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error("Corpus watch failed:", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(2);
});
