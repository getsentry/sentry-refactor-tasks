import { z } from "zod";

export const PatternSchema = z.object({
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
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  prefilter: z.string().optional(),
  detect_command: z.string().optional(),
});

export type Pattern = z.infer<typeof PatternSchema>;

export const RepoConfigSchema = z.object({
  sentry_dsn: z.string().url(),
  default_model: z.enum(["haiku", "sonnet", "opus"]).default("haiku"),
  scan_concurrency: z.number().int().positive().default(4),
});

export type RepoConfig = z.infer<typeof RepoConfigSchema>;

/**
 * A {@link RepoConfig} resolved against a local repo. `path` is the repo root
 * (the directory containing the `.sentry-refactor-tasks/` config folder) and is
 * also the scan target — scanning runs in place, with no clone. `repo` is the
 * GitHub "owner/name" slug, derived from the checkout's git origin remote (not
 * configured in repo.yaml) and used for issue permalinks.
 */
export type ResolvedRepoConfig = RepoConfig & { path: string; repo: string };

const FindingSchema = z.object({
  file: z.string(),
  line_start: z.number(),
  line_end: z.number(),
  snippet: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  explanation: z.string(),
});

export const FindingsResponseSchema = z.object({
  findings: z.array(FindingSchema),
});

export type FindingsResponse = z.infer<typeof FindingsResponseSchema>;

export const findingsJsonSchema = z.toJSONSchema(FindingsResponseSchema, {
  target: "draft-7",
});
