/**
 * Cut a file down to windows of lines around matches of `match`, each labelled
 * with its real line range. Most of a scan's input is code far from anything
 * the convention cares about; sending only the neighbourhood of each match cut
 * prompt tokens 5-9x without losing recall.
 */
export function excerptContent(content: string, match: string, context: number): string {
  const anchor = new RegExp(match);
  const lines = content.split("\n");
  const windows: Array<[number, number]> = [];

  lines.forEach((line, i) => {
    if (!anchor.test(line)) return;
    const start = Math.max(0, i - context);
    const end = Math.min(lines.length - 1, i + context);
    const last = windows.at(-1);
    if (last && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      windows.push([start, end]);
    }
  });

  return windows
    .map(
      ([start, end]) =>
        `[lines ${start + 1}-${end + 1}]\n${lines.slice(start, end + 1).join("\n")}`,
    )
    .join("\n[...]\n");
}
