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

export function correctLineNumbers(finding: RawFinding, fileContent: string): RawFinding {
  const snippetLines = finding.snippet.trim().split("\n");
  const firstLine = snippetLines[0].trim();
  if (!firstLine) return finding;

  const contentLines = fileContent.split("\n");

  // Search near the LLM's reported line first (within ±50 lines), then full file
  const searchStart = Math.max(0, finding.line_start - 50);
  const searchEnd = Math.min(contentLines.length, finding.line_start + 50);

  let matchLine = -1;
  for (let i = searchStart; i < searchEnd; i++) {
    if (contentLines[i].trim() === firstLine) {
      matchLine = i;
      break;
    }
  }

  if (matchLine === -1) {
    for (let i = 0; i < contentLines.length; i++) {
      if (contentLines[i].trim() === firstLine) {
        matchLine = i;
        break;
      }
    }
  }

  if (matchLine === -1) return finding;

  const lineOffset = matchLine + 1 - finding.line_start;
  return {
    ...finding,
    line_start: finding.line_start + lineOffset,
    line_end: finding.line_end + lineOffset,
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
