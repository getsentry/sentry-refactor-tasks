/**
 * Build ground truth for the LLM conventions and score benchmark runs against it.
 *
 * Recall measured only against the union of what the runs found would hide
 * violations every config missed, so instead every prefilter anchor line (each
 * `@deprecated`, each `api.request(`, ...) is a candidate site, plus any finding
 * that doesn't sit near an anchor. A strong model judges each site once on a
 * window of surrounding code; verdicts are cached in results/judgements.json.
 *
 * Usage: node bench/judge.ts --repo ~/code/sentry [--judge-model anthropic/claude-opus-5.5] [--no-judge]
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import pLimit from "p-limit";
import { loadAllPatterns } from "../src/config/load-pattern.ts";
import { resolveRepo } from "../src/config/resolve-repo.ts";
import type { Pattern } from "../src/config/schemas.ts";
import { readFilesForAnalysis } from "../src/scanner/claude.ts";
import { getFilesToScan } from "../src/scanner/prefilter.ts";
import { repoSlug } from "../src/scanner/scan-cache.ts";

const { values: args } = parseArgs({
  options: {
    repo: { type: "string" },
    "judge-model": { type: "string", default: "anthropic/claude-opus-5.5" },
    "no-judge": { type: "boolean", default: false },
  },
});

const ANCHORS: Record<string, RegExp> = {
  "deprecated-needs-replacement": /@deprecated/,
  "no-callback-api-request": /api\.request\(|api\.requestPromise\(/,
  "no-class-components": /extends (React\.)?(Pure)?Component/,
  "no-custom-render-helper":
    /^\s*(export )?(async )?function render[A-Z]|^\s*(const|let) render[A-Z][A-Za-z0-9]*\s*=/,
};

const resultsDir = join(import.meta.dirname, "results");
const judgementsPath = join(resultsDir, "judgements.json");

interface Site {
  pattern: string;
  file: string;
  line: number;
  onAnchor: boolean;
}
const siteKey = (s: { pattern: string; file: string; line: number }) =>
  `${s.pattern}|${s.file}|${s.line}`;

/** Map a finding to the anchor line it is about, so runs that report the JSDoc line vs. the declaration line agree. */
function canonicalLine(anchors: number[], start: number, end: number): number | undefined {
  const near = anchors.filter((a) => a >= start - 15 && a <= end + 2);
  if (near.length === 0) return undefined;
  return near.reduce((best, a) => (Math.abs(a - start) < Math.abs(best - start) ? a : best));
}

function window(lines: string[], line: number): string {
  const from = Math.max(1, line - 15);
  const to = Math.min(lines.length, line + 35);
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(`${String(n).padStart(5)}${n === line ? " >>" : "   "} ${lines[n - 1]}`);
  return out.join("\n");
}

const verdictSchema = {
  type: "object",
  properties: {
    reasoning: { type: "string" },
    is_violation: { type: "boolean" },
  },
  required: ["reasoning", "is_violation"],
  additionalProperties: false,
};

async function judge(pattern: Pattern, file: string, code: string, line: number) {
  const examples = pattern.examples
    ? `\nBad examples:\n${pattern.examples.bad.map((e) => `- ${e}`).join("\n")}\nGood examples:\n${pattern.examples.good.map((e) => `- ${e}`).join("\n")}`
    : "";
  const prompt = `You are building ground truth for a code-convention scanner.

Convention: ${pattern.name}
Detection rules:
${pattern.detect}${examples}

File: ${file}
The marked line (>>) is ${line}. Decide whether there is a violation of this convention AT the marked line, i.e. one a scanner should report there (for a multi-line construct, the marked line belongs to it). Judge only that construct, not others in the window. If the window does not show enough to decide, judge from what is visible and the rules' intent.

${code}`;
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args["judge-model"],
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_schema", json_schema: { name: "verdict", strict: true, schema: verdictSchema } },
      usage: { include: true },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const data: any = await res.json();
  if (!res.ok || data.error) throw new Error(JSON.stringify(data.error ?? data).slice(0, 300));
  const verdict = JSON.parse(data.choices[0].message.content);
  const cost = data.usage?.cost_details?.upstream_inference_cost ?? data.usage?.cost ?? 0;
  return { ...verdict, cost };
}

const config = await resolveRepo(args.repo ?? process.cwd());
const patterns = (await loadAllPatterns(config.path)).filter((p) => !p.detect_command);

const runFiles = (await readdir(resultsDir)).filter(
  (f) =>
    f.endsWith(".json") &&
    !f.startsWith("smoke") &&
    !["judgements.json", "summary.json"].includes(f) &&
    !f.includes(".batch-"),
);
const runs = await Promise.all(runFiles.map(async (f) => JSON.parse(await readFile(join(resultsDir, f), "utf-8"))));

let judgements: Record<string, { is_violation: boolean; reasoning: string; cost: number }> = {};
try {
  judgements = JSON.parse(await readFile(judgementsPath, "utf-8"));
} catch {}

// pattern -> run label -> set of site keys it reported
const reported = new Map<string, Map<string, Set<string>>>();
// Same, plus findings the scanner dropped as unlocatable but a looser match recovers.
const reportedLenient = new Map<string, Map<string, Set<string>>>();

/**
 * Models often collapse a multi-line construct into one abbreviated line
 * (`class Foo extends Component<P> { ... render() {...} }`), which the
 * scanner's exact line matching rejects. Accept a nearby real line that the
 * snippet's first line starts with.
 */
function lenientLocate(lines: string[] | undefined, f: { snippet: string; line_start: number }) {
  if (!lines) return undefined;
  const first = f.snippet.replaceAll("\\n", "\n").split("\n").map((l) => l.trim()).find(Boolean);
  if (!first) return undefined;
  let best: number | undefined;
  for (let n = Math.max(1, f.line_start - 20); n <= Math.min(lines.length, f.line_start + 20); n++) {
    const text = lines[n - 1].trim();
    if (text.length < 10 || !first.startsWith(text.replace(/\s*\{$/, ""))) continue;
    if (best === undefined || Math.abs(n - f.line_start) < Math.abs(best - f.line_start)) best = n;
  }
  return best;
}
const sites = new Map<string, Site>();
const fileLines = new Map<string, string[]>();

for (const pattern of patterns) {
  const anchor = ANCHORS[pattern.name];
  const paths = await getFilesToScan(pattern, config, repoSlug(config.repo));
  const files = await readFilesForAnalysis(paths, config.path);
  const anchorsByFile = new Map<string, number[]>();
  for (const f of files) {
    const lines = f.content.split("\n");
    fileLines.set(f.relativePath, lines);
    const anchors = lines.flatMap((l, i) => (anchor.test(l) ? [i + 1] : []));
    anchorsByFile.set(f.relativePath, anchors);
    for (const line of anchors) {
      const s = { pattern: pattern.name, file: f.relativePath, line, onAnchor: true };
      sites.set(siteKey(s), s);
    }
  }

  const byRun = new Map<string, Set<string>>();
  const byRunLenient = new Map<string, Set<string>>();
  for (const run of runs) {
    const result = run.results.find((r: any) => r.pattern === pattern.name);
    if (!result) continue;
    const keys = new Set<string>();
    for (const f of result.findings) {
      const line = canonicalLine(anchorsByFile.get(f.file) ?? [], f.line_start, f.line_end) ?? f.line_start;
      const s = { pattern: pattern.name, file: f.file, line, onAnchor: false };
      const key = siteKey(s);
      if (!sites.has(key)) sites.set(key, s);
      keys.add(key);
    }
    byRun.set(run.label, keys);

    const lenient = new Set(keys);
    for (const f of result.unlocated ?? []) {
      const line = lenientLocate(fileLines.get(f.file), f);
      if (line === undefined) continue;
      const anchorLine = canonicalLine(anchorsByFile.get(f.file) ?? [], line, line + (f.line_end - f.line_start));
      if (anchorLine !== undefined) lenient.add(siteKey({ pattern: pattern.name, file: f.file, line: anchorLine }));
    }
    byRunLenient.set(run.label, lenient);
  }
  reportedLenient.set(pattern.name, byRunLenient);
  reported.set(pattern.name, byRun);
}

if (!args["no-judge"]) {
  const todo = [...sites.entries()].filter(([key]) => !judgements[key]);
  console.error(`Judging ${todo.length} of ${sites.size} sites with ${args["judge-model"]}`);
  const limit = pLimit(8);
  let done = 0;
  await Promise.all(
    todo.map(([key, s]) =>
      limit(async () => {
        const pattern = patterns.find((p) => p.name === s.pattern)!;
        try {
          judgements[key] = await judge(pattern, s.file, window(fileLines.get(s.file)!, s.line), s.line);
        } catch (err) {
          console.error(`  ${key}: ${err instanceof Error ? err.message : err}`);
        }
        if (++done % 50 === 0) {
          console.error(`  ${done}/${todo.length}`);
          await writeFile(judgementsPath, JSON.stringify(judgements, null, 1));
        }
      }),
    ),
  );
  await writeFile(judgementsPath, JSON.stringify(judgements, null, 1));
  const judgeCost = Object.values(judgements).reduce((n, j) => n + (j.cost ?? 0), 0);
  console.error(`Judge cost so far: $${judgeCost.toFixed(2)}`);
}

// ---- scoring ----
const truth = new Map<string, Set<string>>();
for (const [key, s] of sites) {
  if (!judgements[key]?.is_violation) continue;
  if (!truth.has(s.pattern)) truth.set(s.pattern, new Set());
  truth.get(s.pattern)!.add(key);
}
const unjudged = [...sites.keys()].filter((k) => !judgements[k]).length;

const rows = runs
  .map((run) => {
    let tp = 0;
    let tpLenient = 0;
    let reportedN = 0;
    const per: Record<string, string> = {};
    for (const pattern of patterns) {
      const keys = reported.get(pattern.name)?.get(run.label) ?? new Set<string>();
      const t = truth.get(pattern.name) ?? new Set<string>();
      const hit = [...keys].filter((k) => t.has(k)).length;
      tp += hit;
      const lenientKeys = reportedLenient.get(pattern.name)?.get(run.label) ?? keys;
      tpLenient += [...lenientKeys].filter((k) => t.has(k)).length;
      reportedN += keys.size;
      per[pattern.name] = `${hit}/${t.size}`;
    }
    const totalTruth = [...truth.values()].reduce((n, s) => n + s.size, 0);
    return {
      label: run.label,
      costUsd: run.totals.costUsd,
      promptTokens: run.totals.promptTokens,
      completionTokens: run.totals.completionTokens,
      wallS: run.totals.wallS,
      errors: run.totals.errors,
      recall: tp / totalTruth,
      recallLenient: tpLenient / totalTruth,
      unlocatable: run.results.reduce((n: number, r: any) => n + r.unlocatable, 0),
      precision: reportedN ? tp / reportedN : 0,
      per,
    };
  })
  .sort((a, b) => a.label.localeCompare(b.label));

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const lines = [
  `Ground truth: ${[...truth.entries()].map(([p, s]) => `${p}=${s.size}`).join(", ")} (from ${sites.size} sites, ${unjudged} unjudged)`,
  "",
  `| run | cost | in tok | out tok | wall s | errors | unlocatable | recall | recall (lenient locate) | precision | ${patterns.map((p) => p.name).join(" | ")} |`,
  `|---|---|---|---|---|---|---|---|---|---|${patterns.map(() => "---").join("|")}|`,
  ...rows.map(
    (r) =>
      `| ${r.label} | $${r.costUsd.toFixed(4)} | ${r.promptTokens} | ${r.completionTokens} | ${r.wallS.toFixed(0)} | ${r.errors} | ${r.unlocatable} | ${pct(r.recall)} | ${pct(r.recallLenient)} | ${pct(r.precision)} | ${patterns.map((p) => r.per[p.name]).join(" | ")} |`,
  ),
];
// Repetitions of one config (label suffix -rN) vary a lot, so also report their mean and range.
const groups = new Map<string, typeof rows>();
for (const r of rows) {
  const config = r.label.replace(/-r\d+$/, "");
  groups.set(config, [...(groups.get(config) ?? []), r]);
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const range = (xs: number[]) =>
  xs.length > 1 ? ` (${pct(Math.min(...xs))}–${pct(Math.max(...xs))})` : "";
lines.push(
  "",
  "| config | reps | mean cost | mean wall s | strict recall | lenient recall | precision |",
  "|---|---|---|---|---|---|---|",
  ...[...groups.entries()]
    .sort(([, a], [, b]) => mean(a.map((r) => r.costUsd)) - mean(b.map((r) => r.costUsd)))
    .map(([config, rs]) => {
      const strict = rs.map((r) => r.recall);
      const lenient = rs.map((r) => r.recallLenient);
      return `| ${config} | ${rs.length} | $${mean(rs.map((r) => r.costUsd)).toFixed(3)} | ${mean(rs.map((r) => r.wallS)).toFixed(0)} | ${pct(mean(strict))}${range(strict)} | ${pct(mean(lenient))}${range(lenient)} | ${pct(mean(rs.map((r) => r.precision)))} |`;
    }),
);
console.log(lines.join("\n"));
await writeFile(join(resultsDir, "summary.md"), lines.join("\n") + "\n");
await writeFile(join(resultsDir, "summary.json"), JSON.stringify(rows, null, 2));
