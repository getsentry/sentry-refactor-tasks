import { z } from "zod";

/**
 * Which files the LLM path reads, and how much of each it sends. `match` is a
 * JavaScript regex tested line by line: a file is a candidate when any line
 * matches, and with `excerpt` set the model sees only the matching lines plus
 * that many lines on each side, instead of the whole file.
 */
export const SearchSchema = z.object({
  match: z.string().refine(isValidRegex, "must be a valid JavaScript regular expression"),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  excerpt: z.number().int().nonnegative().optional(),
});

export type Search = z.infer<typeof SearchSchema>;

export const PatternSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9-]+$/),
    severity: z.enum(["error", "warning", "info"]).default("warning"),
    tags: z.array(z.string()).default([]),
    why: z.string(),
    detect: z.string(),
    fix: z.string(),
    examples: z
      .object({
        bad: z.array(z.string()).default([]),
        good: z.array(z.string()).default([]),
      })
      .optional(),
    search: SearchSchema.optional(),
    detect_command: z.string().optional(),
  })
  // Unknown keys are dropped, so a convention with neither path (e.g. a
  // misspelled `search`) would otherwise load and silently scan nothing.
  .refine((p) => Boolean(p.search) !== Boolean(p.detect_command), {
    message:
      "Set exactly one of `search` (LLM path: `{match, include, exclude, excerpt}`) or `detect_command`. Top-level `prefilter`, `include` and `exclude` are no longer read.",
  });

function isValidRegex(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

export type Pattern = z.infer<typeof PatternSchema>;

/**
 * Repo-level scan settings, sourced from environment variables rather than a
 * config file: `INFERENCE_MODEL`, `SCAN_CONCURRENCY`, and
 * `REFACTOR_TASKS_SENTRY_CHUNK_SIZE`. Each coerces from its string env value and
 * falls back to the defaults below when unset.
 */
export const ScanSettingsSchema = z.object({
  default_model: z.enum(["haiku", "sonnet", "opus"]).default("haiku"),
  scan_concurrency: z.coerce.number().int().positive().default(4),
  // Findings per Sentry batch. Left unset, it falls back to the
  // REFACTOR_TASKS_SENTRY_CHUNK_SIZE env var, then a paced default. A positive
  // value sends throttled chunks of that size to stay under the project's rate
  // limit; `0` sends everything in a single unpaced batch.
  chunk_size: z.coerce.number().int().min(0).optional(),
});

export type ScanSettings = z.infer<typeof ScanSettingsSchema>;

/**
 * {@link ScanSettings} resolved against a local repo. `path` is the repo root
 * (the directory containing the `.sentry-refactor-tasks/` config folder) and is
 * also the scan target — scanning runs in place, with no clone. `repo` is the
 * GitHub "owner/name" slug, derived from the checkout's git origin remote and
 * used for issue permalinks.
 */
export type ResolvedRepoConfig = ScanSettings & { path: string; repo: string };

// Structured output is generated in property order. `explanation` precedes
// `is_violation` so the model reasons about a candidate before giving a verdict,
// and can reject one that its own analysis clears.
const FindingSchema = z.object({
  file: z.string(),
  line_start: z.number(),
  line_end: z.number(),
  snippet: z.string(),
  explanation: z
    .string()
    .describe(
      "Check the snippet against the detection rules, including every case they say not to flag, then state the conclusion.",
    ),
  is_violation: z
    .boolean()
    .describe(
      "False when the explanation concludes this code conforms. Such entries are discarded.",
    ),
  confidence: z.enum(["high", "medium", "low"]),
});

export const FindingsResponseSchema = z.object({
  findings: z.array(FindingSchema),
});

export const findingsJsonSchema = z.toJSONSchema(FindingsResponseSchema, {
  target: "draft-7",
});
