import { setTimeout as sleep } from "node:timers/promises";
import * as Sentry from "@sentry/node";
import type { ScanFinding } from "../scanner/result.ts";
import { log, verbose } from "../utils/logger.ts";

/**
 * Sentry rate-limits bursts of ingest independently of spike protection: even
 * with spike protection off, a project's base rate limit still applies. Firing
 * every finding in a tight loop and flushing once trips it — the transport
 * honors the 429 `X-Sentry-Rate-Limits` header and drops the remainder, so many
 * findings never become issues. Crucially a 429 is a *completed* request, so the
 * flush still succeeds; the drop is only visible via transport outcomes.
 *
 * The `chunkSize` control tunes this: `0` (the default) sends everything in a
 * single batch (fast, but only viable when the volume fits under the rate
 * limit), while a positive value sends paced chunks of that size, flushing after
 * each, to stay under it. Either way, dropped events are detected; a transient
 * drop (e.g. a one-off `network_error`) is retried a bounded number of times
 * before the run fails loud, so a single blip out of thousands of events
 * doesn't turn a healthy scan red. The pacing/flush/retry knobs below are
 * tunable via env vars for projects with different limits.
 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envIntOptional(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const CHUNK_DELAY_MS = envInt("REFACTOR_TASKS_SENTRY_CHUNK_DELAY_MS", 1000);
const FLUSH_TIMEOUT_MS = envInt("REFACTOR_TASKS_SENTRY_FLUSH_TIMEOUT_MS", 30_000);

/**
 * Attempts per batch (chunk, or single-batch window) before a drop is treated
 * as unrecoverable. A `network_error` drop is often a one-off blip — a DNS
 * hiccup, a reset connection — rather than a symptom of being rate-limited, so
 * it is worth resending before giving up. Resending re-captures every finding
 * in the batch, including ones already delivered; duplicates land as repeat
 * occurrences of the same Sentry issue (findings are fingerprinted by pattern,
 * file, and line), not separate issues.
 */
const CHUNK_SEND_ATTEMPTS = envInt("REFACTOR_TASKS_SENTRY_SEND_ATTEMPTS", 3);

/**
 * The Sentry transport holds in-flight events in a promise buffer that defaults
 * to 64 slots. `captureMessage` is fire-and-forget, so once the buffer fills the
 * transport rejects the overflow and it is silently dropped — no 429, unrelated
 * to spike protection. We raise the buffer to this floor; the reporter sizes the
 * actual buffer to at least a full chunk (see {@link FindingReporter}) so a send
 * never enqueues past it between flushes, and every finding is delivered.
 */
const BUFFER_SIZE = envInt("REFACTOR_TASKS_SENTRY_BUFFER_SIZE", 1000);

/**
 * Events the transport rejected, tallied by reason (e.g. `ratelimit_backoff`,
 * `network_error`). A rate-limit drop is a *completed* 429 request, so the send
 * promise resolves and `Sentry.flush()` returns `true` — flush success can't
 * see these. We intercept the transport's `recordDroppedEvent` instead so the
 * run can fail loud when data didn't actually reach Sentry.
 */
const droppedEvents = new Map<string, number>();

function recordDrop(reason: string, count: number): void {
  droppedEvents.set(reason, (droppedEvents.get(reason) ?? 0) + count);
}

/** A point-in-time copy of {@link droppedEvents}, to diff against after a send attempt. */
function snapshotDropped(): Map<string, number> {
  return new Map(droppedEvents);
}

/**
 * The drops recorded since `before` was snapshotted, as a total and a
 * `reason=count` summary — i.e. what this specific send attempt caused,
 * not the run's cumulative total.
 */
function droppedSince(before: Map<string, number>): { total: number; summary: string } {
  const delta = new Map<string, number>();
  for (const [reason, count] of droppedEvents) {
    const prior = before.get(reason) ?? 0;
    if (count > prior) delta.set(reason, count - prior);
  }
  let total = 0;
  for (const count of delta.values()) total += count;
  const summary = [...delta.entries()].map(([reason, count]) => `${reason}=${count}`).join(", ");
  return { total, summary };
}

function initSentry(dsn: string, bufferSize: number): void {
  droppedEvents.clear();
  Sentry.init({
    dsn,
    defaultIntegrations: false,
    tracesSampleRate: 0,
    transportOptions: { bufferSize },
    // Wrap the transport so we see every drop it records. The client passes its
    // own `recordDroppedEvent` into the factory; we tee it into our tally. This
    // is done at construction (not a post-init monkeypatch) because the client
    // binds the callback into the transport once, at init.
    transport: (options) =>
      Sentry.makeNodeTransport({
        ...options,
        recordDroppedEvent: (reason, category, count = 1) => {
          recordDrop(reason, count);
          options.recordDroppedEvent(reason, category, count);
        },
      }),
  });
}

function githubUrl(finding: ScanFinding): string {
  return `https://github.com/${finding.repo}/blob/${finding.git_sha}/${finding.file}#L${finding.line_start}-L${finding.line_end}`;
}

function buildMessage(finding: ScanFinding): string {
  const lines = [
    `## [${finding.pattern_name}] ${finding.file}:${finding.line_start}`,
    "",
    `Detected at commit \`${finding.git_sha.slice(0, 8)}\``,
    "",
    "### Code",
    "```",
    finding.snippet,
    "```",
    "",
    "### Problem",
    finding.explanation,
    "",
    "### Why this matters",
    finding.why.trim(),
    "",
    "### How to fix",
    finding.fix.trim(),
  ];
  return lines.join("\n");
}

function reportFinding(finding: ScanFinding): void {
  Sentry.withScope((scope) => {
    scope.setFingerprint([finding.pattern_name, finding.file, String(finding.line_start)]);

    scope.setTag("violation_type", finding.pattern_name);
    scope.setTag("severity", finding.severity);
    scope.setTag("confidence", finding.confidence);
    scope.setTag("repo", finding.repo);
    scope.setTag("git_sha", finding.git_sha);
    scope.setTag("url", githubUrl(finding));
    for (const tag of finding.tags) {
      scope.setTag(`convention.${tag}`, "true");
    }

    scope.setLevel(finding.severity === "error" ? "error" : "warning");

    scope.setContext("violation", {
      file: finding.file,
      line_start: finding.line_start,
      line_end: finding.line_end,
      snippet: finding.snippet,
      why: finding.why,
      fix: finding.fix,
      explanation: finding.explanation,
    });

    Sentry.captureMessage(buildMessage(finding));
  });

  verbose(`Reported: [${finding.pattern_name}] ${finding.file}:${finding.line_start}`);
}

/**
 * Findings per Sentry batch when neither an explicit value nor the
 * `REFACTOR_TASKS_SENTRY_CHUNK_SIZE` env var is set. Paced chunks (this many
 * findings, flushed with a delay between each) keep sends under the project's
 * base rate limit so every finding is delivered.
 */
const DEFAULT_CHUNK_SIZE = 100;

export interface ReportOptions {
  /**
   * Findings per Sentry batch. A positive value sends paced chunks of that size,
   * flushing after each, to stay under the per-project rate limit. `0` sends
   * everything in a single unpaced batch — only viable when the volume fits under
   * the rate limit; it fails loud rather than dropping silently if it doesn't.
   * When unset, falls back to the `REFACTOR_TASKS_SENTRY_CHUNK_SIZE` env var,
   * then {@link DEFAULT_CHUNK_SIZE}.
   */
  chunkSize?: number;
}

function resolveChunkSize(explicit?: number): number {
  const requested =
    explicit ?? envIntOptional("REFACTOR_TASKS_SENTRY_CHUNK_SIZE") ?? DEFAULT_CHUNK_SIZE;
  return Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 0;
}

/**
 * Streaming reporter: accepts findings incrementally via {@link add} and sends
 * them to Sentry as soon as a full chunk has accumulated, so reporting overlaps
 * with scanning instead of waiting for the whole scan to finish. Chunk
 * boundaries span successive `add` calls, so a partial chunk left by one batch
 * of findings is topped up by the next. Call {@link finish} once scanning is
 * done to send any remainder and do a final flush.
 *
 * With `chunkSize <= 0` (the single-batch default) nothing is sent until
 * {@link finish}, matching the send-everything-at-once behavior.
 */
export class FindingReporter {
  private readonly chunkSize: number;
  private readonly bufferSize: number;
  private buffer: ScanFinding[] = [];
  private sent = 0;
  private flushTimeouts = 0;
  private sentAnyChunk = false;
  // Drops that survived every retry attempt for their batch — as opposed to
  // droppedEvents, which is the transport's raw cumulative tally and doesn't
  // distinguish "dropped, then successfully resent" from "dropped for good".
  private unrecoveredDrops = 0;
  private unrecoveredSummaries: string[] = [];

  constructor(dsn: string, options: ReportOptions = {}) {
    this.chunkSize = resolveChunkSize(options.chunkSize);
    // `sendChunk` enqueues a whole chunk before flushing, so the transport
    // buffer must hold at least one chunk or the overflow is silently dropped.
    this.bufferSize = Math.max(BUFFER_SIZE, this.chunkSize);
    initSentry(dsn, this.bufferSize);
  }

  /** Buffer findings, sending any now-complete chunks (when `chunkSize > 0`). */
  async add(findings: ScanFinding[]): Promise<void> {
    if (findings.length === 0) return;
    this.buffer.push(...findings);
    if (this.chunkSize <= 0) return;
    while (this.buffer.length >= this.chunkSize) {
      await this.sendChunk(this.buffer.splice(0, this.chunkSize));
    }
  }

  /** Send whatever is buffered and do a final flush. */
  async finish(): Promise<void> {
    if (this.chunkSize <= 0) {
      // Send in windows no larger than the transport buffer, flushing after
      // each, so we never enqueue past the buffer's capacity — the overflow
      // would be silently dropped. With spike protection off there's no need to
      // pace between windows, so this stays a fast single logical batch.
      const remainder = this.buffer.splice(0);
      for (let i = 0; i < remainder.length; i += this.bufferSize) {
        const window = remainder.slice(i, i + this.bufferSize);
        const drained = await this.sendItems(window);
        this.sent += window.length;
        if (!drained) {
          throw new Error(
            `Sentry flush timed out after ${FLUSH_TIMEOUT_MS}ms; ${this.sent} findings were enqueued but not confirmed delivered. ` +
              `Raise REFACTOR_TASKS_SENTRY_FLUSH_TIMEOUT_MS, or set REFACTOR_TASKS_SENTRY_CHUNK_SIZE to a positive value to send in paced chunks, then re-run.`,
          );
        }
      }
      this.assertNoDrops();
      log(`Reported ${this.sent} findings to Sentry (single batch)`);
      return;
    }

    if (this.buffer.length > 0) {
      await this.sendChunk(this.buffer.splice(0));
    }

    if (this.flushTimeouts > 0) {
      throw new Error(
        `${this.flushTimeouts} chunk flush(es) timed out — some findings may not have been delivered. ` +
          `Increase REFACTOR_TASKS_SENTRY_CHUNK_DELAY_MS or REFACTOR_TASKS_SENTRY_FLUSH_TIMEOUT_MS, or raise the project's rate limit, then re-run.`,
      );
    }

    this.assertNoDrops();
  }

  /**
   * Fail loud if any batch still had dropped events after exhausting its
   * retries. Note this checks {@link unrecoveredDrops}, not the transport's raw
   * cumulative tally — a drop that a retry successfully resent is not a
   * failure, so it must not fail the run just because the transport still
   * remembers the earlier, since-recovered attempt.
   */
  private assertNoDrops(): void {
    if (this.unrecoveredDrops > 0) {
      throw new Error(
        `Sentry dropped ${this.unrecoveredDrops} of ${this.sent} events after ${CHUNK_SEND_ATTEMPTS} attempt(s) each (${this.unrecoveredSummaries.join("; ")}). ` +
          `Set REFACTOR_TASKS_SENTRY_CHUNK_SIZE to a positive value to pace sends under the rate limit, ` +
          `and/or raise REFACTOR_TASKS_SENTRY_CHUNK_DELAY_MS, then re-run.`,
      );
    }
  }

  /**
   * Send `items` to Sentry, retrying the whole batch up to
   * {@link CHUNK_SEND_ATTEMPTS} times if the transport records new drops (e.g. a
   * transient `network_error`) since the attempt started. Resending re-reports
   * every finding in the batch, including any already delivered — see
   * {@link CHUNK_SEND_ATTEMPTS}'s doc comment for why that's fine. Returns
   * whether the final attempt's flush drained; callers decide how to treat an
   * undrained flush. Drops that survive every attempt are folded into
   * {@link unrecoveredDrops}/{@link unrecoveredSummaries} for {@link assertNoDrops}.
   */
  private async sendItems(items: ScanFinding[]): Promise<boolean> {
    let drained = true;

    for (let attempt = 1; attempt <= CHUNK_SEND_ATTEMPTS; attempt++) {
      const before = snapshotDropped();
      for (const finding of items) {
        reportFinding(finding);
      }
      drained = await Sentry.flush(FLUSH_TIMEOUT_MS);
      if (!drained) return false;

      const { total, summary } = droppedSince(before);
      if (total === 0) return true;

      if (attempt < CHUNK_SEND_ATTEMPTS) {
        log(
          `  Sentry dropped ${total} event(s) (${summary}) reporting this batch; retrying (attempt ${attempt + 1}/${CHUNK_SEND_ATTEMPTS})`,
        );
        await sleep(CHUNK_DELAY_MS * attempt);
        continue;
      }

      this.unrecoveredDrops += total;
      this.unrecoveredSummaries.push(summary);
    }

    return drained;
  }

  private async sendChunk(chunk: ScanFinding[]): Promise<void> {
    // Pace between chunks (but not before the first) so the transport can apply
    // 429 backoff between bursts instead of dropping a firehose of events.
    if (this.sentAnyChunk) {
      await sleep(CHUNK_DELAY_MS);
    }
    this.sentAnyChunk = true;

    const drained = await this.sendItems(chunk);
    this.sent += chunk.length;
    if (!drained) {
      this.flushTimeouts++;
      verbose(`Flush timed out after ${this.sent} findings`);
    }

    log(`Reported ${this.sent} findings to Sentry`);
  }
}

export async function reportFindings(
  findings: ScanFinding[],
  dsn: string,
  options: ReportOptions = {},
): Promise<void> {
  const reporter = new FindingReporter(dsn, options);
  await reporter.add(findings);
  await reporter.finish();
}
