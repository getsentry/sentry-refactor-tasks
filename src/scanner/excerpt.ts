import type { Pattern } from "../config/schemas.ts";

/**
 * Cut a file down to windows of lines around matches of the convention's
 * excerpt pattern, each labelled with its real line range. Most of a scan's
 * input is code far from anything the convention cares about; sending only the
 * neighbourhood of each match cut prompt tokens 5-9x without losing recall.
 *
 * A file with no match is sent whole, so a pattern that drifts from the
 * prefilter degrades to the old behaviour instead of hiding the file.
 */
export function excerptContent(content: string, excerpt: NonNullable<Pattern["excerpt"]>): string {
  const anchor = new RegExp(excerpt.pattern);
  const lines = content.split("\n");
  const windows: Array<[number, number]> = [];

  lines.forEach((line, i) => {
    if (!anchor.test(line)) return;
    const start = Math.max(0, i - excerpt.context);
    const end = Math.min(lines.length - 1, i + excerpt.context);
    const last = windows.at(-1);
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      windows.push([start, end]);
    }
  });

  if (windows.length === 0) return content;
  return windows
    .map(
      ([start, end]) =>
        `[lines ${start + 1}-${end + 1}]\n${lines.slice(start, end + 1).join("\n")}`,
    )
    .join("\n[...]\n");
}
