/**
 * Benchmark the LLM scan path against a real repo with different models, batch
 * sizes and prompt shapes, recording cost/tokens/latency per request.
 *
 * It drives the real scanner functions (prefilter, prompt, schema, locate) so
 * numbers reflect what CI would do; only batching and transport are swapped:
 * `fetch` is wrapped to capture OpenRouter usage, and in --batch-api mode to
 * route every request through OpenRouter's async Batch API instead.
 *
 * Usage:
 *   node bench/run.ts --repo ~/code/sentry --label h55-f20 \
 *     --model anthropic/claude-haiku-5.5 --files 20 --tokens 80000 \
 *     [--excerpt 25] [--reasoning low] [--batch-api] [--concurrency 4] [--patterns a,b]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import pLimit from "p-limit";
import { loadAllPatterns } from "../src/config/load-pattern.ts";
import { resolveRepo } from "../src/config/resolve-repo.ts";
import type { Pattern } from "../src/config/schemas.ts";
import { analyzeWithClaude, readFilesForAnalysis, type FileContent } from "../src/scanner/claude.ts";
import { getFilesToScan } from "../src/scanner/prefilter.ts";
import { locateFinding, type RawFinding } from "../src/scanner/result.ts";
import { repoSlug } from "../src/scanner/scan-cache.ts";

const { values: args } = parseArgs({
  options: {
    repo: { type: "string" },
    label: { type: "string" },
    model: { type: "string", default: "anthropic/claude-haiku-5.5" },
    files: { type: "string", default: "20" },
    tokens: { type: "string", default: "80000" },
    excerpt: { type: "string" },
    reasoning: { type: "string" },
    "batch-api": { type: "boolean", default: false },
    "verbatim-snippet": { type: "boolean", default: false },
    concurrency: { type: "string", default: "4" },
    patterns: { type: "string" },
  },
});

const MAX_FILES = Number(args.files);
const MAX_TOKENS = Number(args.tokens);
const EXCERPT_CONTEXT = args.excerpt === undefined ? undefined : Number(args.excerpt);

// Lines worth showing the model in excerpt mode; mirrors each prefilter's grep.
const EXCERPT_ANCHORS: Record<string, RegExp> = {
  "deprecated-needs-replacement": /@deprecated/,
  "no-callback-api-request": /api\.request\(|api\.requestPromise\(/,
  "no-class-components": /extends (React\.)?(Pure)?Component/,
  "no-custom-render-helper":
    /^\s*(export )?(async )?function render[A-Z]|^\s*(const|let) render[A-Z][A-Za-z0-9]*\s*=/,
};

interface RequestRecord {
  pattern: string;
  files: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  costUsd: number;
  latencyMs: number;
  status: number;
}

const requests: RequestRecord[] = [];
let currentPattern = "";

const OR_BASE = "https://openrouter.ai/api/v1";
const realFetch = globalThis.fetch;

type Pending = { customId: string; body: Record<string, unknown>; resolve: (r: Response) => void };
let batchQueue: Pending[] = [];

function recordUsage(body: Record<string, unknown>, data: any, latencyMs: number, status: number) {
  const usage = data?.usage ?? {};
  const prompt = String((body.messages as Array<{ content: string }>).at(-1)?.content ?? "");
  requests.push({
    pattern: currentPattern,
    files: (prompt.match(/\n--- end ---/g) ?? []).length,
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
    // BYOK: OpenRouter's own `cost` is just its fee; the provider bill is upstream.
    costUsd: usage.cost_details?.upstream_inference_cost ?? usage.cost ?? 0,
    latencyMs,
    status,
  });
}

globalThis.fetch = async (input: any, init?: any) => {
  const url = String(input);
  if (!url.endsWith("/chat/completions")) return realFetch(input, init);

  const body = JSON.parse(init.body);
  body.usage = { include: true };
  if (args["verbatim-snippet"]) {
    const user = body.messages.at(-1);
    user.content +=
      "\n\nCopy each `snippet` verbatim from the source file: the first lines of the flagged code exactly as written, with the original line breaks. Do not reformat, join lines, or abbreviate with `...`.";
  }
  if (args.reasoning === "off") body.reasoning = { enabled: false };
  else if (args.reasoning) body.reasoning = { effort: args.reasoning };

  if (args["batch-api"]) {
    return new Promise<Response>((resolve) => {
      batchQueue.push({ customId: `req-${batchQueue.length}`, body, resolve });
    });
  }

  const t0 = performance.now();
  const res = await realFetch(input, { ...init, body: JSON.stringify(body) });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {}
  recordUsage(body, data, performance.now() - t0, res.status);
  return new Response(text, { status: res.status, statusText: res.statusText });
};

async function orJson(path: string, init?: RequestInit): Promise<any> {
  const res = await realFetch(`${OR_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

/** Submit every queued request as one async batch and resolve each when done. */
async function flushBatch(expected: number): Promise<{ batchId: string; wallMs: number }> {
  for (let waited = 0; batchQueue.length < expected; waited += 50) {
    if (waited > 30_000) throw new Error(`only ${batchQueue.length}/${expected} requests queued`);
    await new Promise((r) => setTimeout(r, 50));
  }
  const queue = batchQueue;
  batchQueue = [];
  const model = `${queue[0].body.model}:batch`;
  const t0 = performance.now();
  console.error(`  submitting ${queue.length} requests to ${model}`);
  const submitted = await orJson("/batches", {
    method: "POST",
    body: JSON.stringify({
      endpoint: "/v1/chat/completions",
      model,
      requests: queue.map(({ customId, body }) => {
        const { model: _, ...rest } = body;
        return { custom_id: customId, body: rest };
      }),
    }),
  });
  console.error(`  batch ${submitted.id} submitted (${queue.length} requests)`);

  let batch: any;
  for (;;) {
    await new Promise((r) => setTimeout(r, 15_000));
    batch = await orJson(`/batches/${submitted.id}`);
    console.error(
      `  batch ${batch.status} ${JSON.stringify(batch.request_counts)} ${((performance.now() - t0) / 1000).toFixed(0)}s`,
    );
    if (["completed", "failed", "expired", "cancelled"].includes(batch.status)) break;
  }
  const wallMs = performance.now() - t0;
  await writeFile(join(outDir, `${label}.batch-${currentPattern}.json`), JSON.stringify(batch, null, 2));

  const byId = new Map<string, any>((batch.results ?? []).map((r: any) => [r.custom_id, r]));
  // Batch results carry no per-request cost, only a batch total; spread it by tokens.
  const batchCost = batch.usage?.cost_details?.upstream_inference_cost ?? batch.usage?.cost ?? 0;
  const batchTokens = batch.usage?.total_tokens || 1;
  for (const p of queue) {
    const r = byId.get(p.customId);
    const data = r?.response?.body ?? r?.body ?? r;
    const status = r?.response?.status_code ?? (data?.choices ? 200 : 500);
    recordUsage(p.body, data, wallMs, status);
    const rec = requests.at(-1)!;
    rec.costUsd = (batchCost * (rec.promptTokens + rec.completionTokens)) / batchTokens;
    p.resolve(
      new Response(JSON.stringify(data ?? { error: { message: "missing batch result" } }), {
        status,
      }),
    );
  }
  return { batchId: submitted.id, wallMs };
}

function batchFiles(files: FileContent[]): FileContent[][] {
  const batches: FileContent[][] = [];
  let current: FileContent[] = [];
  let tokens = 0;
  for (const file of files) {
    const fileTokens = Math.ceil(file.content.length / 4);
    if (current.length >= MAX_FILES || (tokens + fileTokens > MAX_TOKENS && current.length > 0)) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(file);
    tokens += fileTokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Keep only windows of lines around anchor matches, labelled with their real line range. */
function excerpt(content: string, anchor: RegExp, context: number): string {
  const lines = content.split("\n");
  const windows: Array<[number, number]> = [];
  lines.forEach((line, i) => {
    if (!anchor.test(line)) return;
    const start = Math.max(0, i - context);
    const end = Math.min(lines.length - 1, i + context);
    const last = windows.at(-1);
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else windows.push([start, end]);
  });
  if (windows.length === 0) return content;
  return windows
    .map(([s, e]) => `// [lines ${s + 1}-${e + 1}]\n${lines.slice(s, e + 1).join("\n")}`)
    .join("\n// [...]\n");
}

const label = args.label ?? "run";
const outDir = join(import.meta.dirname, "results");

async function scanPattern(pattern: Pattern, config: Awaited<ReturnType<typeof resolveRepo>>) {
  currentPattern = pattern.name;
  const paths = await getFilesToScan(pattern, config, repoSlug(config.repo));
  const originals = await readFilesForAnalysis(paths, config.path);
  const anchor = EXCERPT_ANCHORS[pattern.name];
  const sent =
    EXCERPT_CONTEXT === undefined || !anchor
      ? originals
      : originals.map((f) => ({ ...f, content: excerpt(f.content, anchor, EXCERPT_CONTEXT) }));
  const batches = batchFiles(sent);

  const t0 = performance.now();
  const errors: string[] = [];
  const limit = pLimit(args["batch-api"] ? batches.length : Number(args.concurrency));
  const run = Promise.all(
    batches.map((batch) =>
      limit(async () => {
        try {
          return await analyzeWithClaude(pattern, batch, args.model!);
        } catch (err) {
          errors.push(err instanceof Error ? err.message.slice(0, 300) : String(err));
          return [] as RawFinding[];
        }
      }),
    ),
  );
  if (args["batch-api"]) await flushBatch(batches.length);
  const raw = (await run).flat();
  const wallS = (performance.now() - t0) / 1000;

  const contents = new Map(originals.map((f) => [f.relativePath, f.content]));
  const located = raw.flatMap((f) => {
    const content = contents.get(f.file);
    const loc = content === undefined ? null : locateFinding(f, content);
    return loc ? [loc] : [];
  });
  const seen = new Set<string>();
  const findings = located.filter((f) => {
    const key = `${f.file}:${f.line_start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.error(
    `${label} ${pattern.name}: ${paths.length} files, ${batches.length} batches, ${findings.length} findings (${raw.length - located.length} unlocatable), ${errors.length} errors, ${wallS.toFixed(1)}s`,
  );
  return {
    pattern: pattern.name,
    files: paths.length,
    sentChars: sent.reduce((n, f) => n + f.content.length, 0),
    batches: batches.length,
    wallS,
    errors,
    unlocatable: raw.length - located.length,
    unlocated: raw.filter((f) => {
      const content = contents.get(f.file);
      return content === undefined || !locateFinding(f, content);
    }),
    findings,
  };
}

const config = await resolveRepo(args.repo ?? process.cwd());
const only = args.patterns?.split(",");
const patterns = (await loadAllPatterns(config.path)).filter(
  (p) => !p.detect_command && (!only || only.includes(p.name)),
);

await mkdir(outDir, { recursive: true });
const results = [];
for (const pattern of patterns) results.push(await scanPattern(pattern, config));

const totals = {
  costUsd: requests.reduce((n, r) => n + r.costUsd, 0),
  promptTokens: requests.reduce((n, r) => n + r.promptTokens, 0),
  completionTokens: requests.reduce((n, r) => n + r.completionTokens, 0),
  reasoningTokens: requests.reduce((n, r) => n + r.reasoningTokens, 0),
  wallS: results.reduce((n, r) => n + r.wallS, 0),
  findings: results.reduce((n, r) => n + r.findings.length, 0),
  errors: results.reduce((n, r) => n + r.errors.length, 0),
};
console.error(`${label} TOTAL ${JSON.stringify(totals)}`);
await writeFile(
  join(outDir, `${label}.json`),
  JSON.stringify({ label, args, totals, results, requests }, null, 2),
);
