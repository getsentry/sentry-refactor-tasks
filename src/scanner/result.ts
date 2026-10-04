import type { Pattern } from "../config/schemas.ts";

export interface ScanFinding {
  pattern_name: string;
  severity: "error" | "warning" | "info";
  file: string;
  line_start: number;
  line_end: number;
  snippet: string;
  confidence: "high" | "medium" | "low";
  explanation: string;
  why: string;
  fix: string;
  tags: string[];
  repo: string;
  git_sha: string;
}

export interface RawFinding {
  file: string;
  line_start: number;
  line_end: number;
  snippet: string;
  confidence: "high" | "medium" | "low";
  explanation: string;
}

export function hydrateFinding(
  raw: RawFinding,
  pattern: Pattern,
  repoName: string,
  gitSha: string,
): ScanFinding {
  return {
    pattern_name: pattern.name,
    severity: pattern.severity,
    file: raw.file,
    line_start: raw.line_start,
    line_end: raw.line_end,
    snippet: raw.snippet,
    confidence: raw.confidence,
    explanation: raw.explanation,
    why: pattern.why,
    fix: pattern.fix,
    tags: pattern.tags,
    repo: repoName,
    git_sha: gitSha,
  };
}

/**
 * Pin a finding to where its snippet actually is in the file, since LLM line
 * numbers drift. Returns null when the snippet isn't in the file at all: in a
 * multi-file batch the model sometimes attributes one file's code to another,
 * and such a finding points at nothing real.
 */
export function locateFinding(finding: RawFinding, fileContent: string): RawFinding | null {
  // Models occasionally double-escape newlines inside the JSON string.
  const snippet = finding.snippet.includes("\n")
    ? finding.snippet
    : finding.snippet.replaceAll("\\n", "\n");
  const wanted = snippet
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (wanted.length === 0) return null;

  const present = fileContent
    .split("\n")
    .map((text, i) => ({ text: text.trim(), line: i + 1 }))
    .filter((l) => l.text);
  const nearest = (lines: number[]) =>
    lines.reduce((best, line) =>
      Math.abs(line - finding.line_start) < Math.abs(best - finding.line_start) ? line : best,
    );

  const fullMatches: Array<{ start: number; end: number }> = [];
  for (let i = 0; i + wanted.length <= present.length; i++) {
    if (wanted.every((text, j) => present[i + j].text === text)) {
      fullMatches.push({ start: present[i].line, end: present[i + wanted.length - 1].line });
    }
  }
  if (fullMatches.length > 0) {
    const start = nearest(fullMatches.map((m) => m.start));
    const { end } = fullMatches.find((m) => m.start === start)!;
    return { ...finding, snippet, line_start: start, line_end: end };
  }

  // Snippets are often abbreviated (`{ ... }`, cut off mid-body), so fall back
  // to the longest snippet line that does appear. Short lines like `/**` or `}`
  // recur throughout any file and can't vouch for a location.
  const presentTexts = new Set(present.map((l) => l.text));
  const anchor = wanted
    .filter((text) => text.length >= 10 && presentTexts.has(text))
    .reduce<string | undefined>((a, b) => (a && a.length >= b.length ? a : b), undefined);
  if (anchor === undefined) return null;
  const offset = wanted.indexOf(anchor);
  const starts = present.filter((l) => l.text === anchor).map((l) => l.line - offset);
  const start = nearest(starts);
  return {
    ...finding,
    snippet,
    line_start: start,
    line_end: start + finding.line_end - finding.line_start,
  };
}

export function deduplicateFindings(findings: ScanFinding[]): ScanFinding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    const key = `${f.pattern_name}:${f.file}:${f.line_start}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
