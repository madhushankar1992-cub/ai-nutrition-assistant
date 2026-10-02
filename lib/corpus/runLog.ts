// Run logging for the scheduled pipeline.
//
// A scheduled job that only prints to stdout is hard to debug after the fact:
// GitHub Actions logs expire, and a local run scrolls away. Every run writes a
// timestamped, phase-tagged log to logs/ so the whole pipeline is auditable.
//
// Logs are written as they happen, not buffered to the end, so a run that
// crashes halfway still leaves evidence of where it got to.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export type Phase =
  | "START" | "SCRAPE" | "VERIFY" | "EXTRACT" | "CLASSIFY"
  | "CHUNK" | "EMBED" | "STORE" | "SUMMARY" | "ERROR" | "DONE";

export type Level = "INFO" | "WARN" | "ERROR";

const LOG_DIR = "logs";

export class RunLog {
  readonly file: string;
  readonly startedAt = Date.now();
  private counts: Record<Level, number> = { INFO: 0, WARN: 0, ERROR: 0 };

  constructor(readonly runName: string, readonly runId: string) {
    mkdirSync(LOG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.file = path.join(LOG_DIR, `${runName}-${stamp}.log`);
    writeFileSync(
      this.file,
      `# ${runName} run ${runId}\n# started ${new Date().toISOString()}\n` +
        `# node ${process.version} · ${process.platform}\n\n`,
      "utf8"
    );
  }

  /** Write one line to the log file and mirror it to the console. */
  log(phase: Phase, message: string, level: Level = "INFO", source?: string): void {
    this.counts[level] += 1;
    const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(1).padStart(6);
    const line =
      `${new Date().toISOString()} +${elapsed}s [${level.padEnd(5)}] ` +
      `[${phase.padEnd(8)}]${source ? ` [${source}]` : ""} ${message}`;
    appendFileSync(this.file, line + "\n", "utf8");

    const console_ = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;
    console_(`  [${phase}]${source ? ` ${source}:` : ""} ${message}`);
  }

  info(phase: Phase, msg: string, source?: string) { this.log(phase, msg, "INFO", source); }
  warn(phase: Phase, msg: string, source?: string) { this.log(phase, msg, "WARN", source); }
  error(phase: Phase, msg: string, source?: string) { this.log(phase, msg, "ERROR", source); }

  /** Append a block without the per-line prefix — for tables and summaries. */
  block(text: string): void {
    appendFileSync(this.file, "\n" + text + "\n", "utf8");
  }

  finish(ok: boolean): { durationMs: number; counts: Record<Level, number>; file: string } {
    const durationMs = Date.now() - this.startedAt;
    this.log("DONE", `${ok ? "SUCCESS" : "FAILED"} in ${(durationMs / 1000).toFixed(1)}s ` +
      `(${this.counts.WARN} warnings, ${this.counts.ERROR} errors)`, ok ? "INFO" : "ERROR");
    appendFileSync(this.file, `\n# finished ${new Date().toISOString()}\n`, "utf8");
    return { durationMs, counts: { ...this.counts }, file: this.file };
  }
}
