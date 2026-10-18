import type { DocPage } from "./page";

// A section headed {label=OPEN-QUESTION}: what the authors couldn't establish, for the platform
// team. Employees don't get it; the IT guide lists them all on one page.
export interface OpenQuestion {
  readonly page: DocPage;
  readonly heading: string;
  // The section's Markdown under its heading.
  readonly body: string;
}

const HEADING = /^(#{1,6}) (.*)$/;
const OPEN = /\s*\{label=OPEN-QUESTION\}\s*$/;

// Each open-question section's line range [start, end) in the body.
function ranges(lines: readonly string[]): readonly (readonly [number, number])[] {
  const found: [number, number][] = [];
  lines.forEach((line, start) => {
    const match = HEADING.exec(line);
    if (match === null || !OPEN.test(line)) return;
    const level = match[1]?.length ?? 1;
    let end = start + 1;
    while (end < lines.length) {
      const next = HEADING.exec(lines[end] ?? "");
      if (next !== null && (next[1]?.length ?? 1) <= level) break;
      end++;
    }
    found.push([start, end]);
  });
  return found;
}

export function withoutOpenQuestions(markdown: string): string {
  const lines = markdown.split("\n");
  const drop = ranges(lines);
  return lines
    .filter((_, index) => !drop.some(([start, end]) => index >= start && index < end))
    .join("\n");
}

export function openQuestionsOf(pages: readonly DocPage[]): readonly OpenQuestion[] {
  return pages.flatMap((page) => {
    const lines = page.body.split("\n");
    return ranges(lines).map(([start, end]) => ({
      page,
      heading: (HEADING.exec(lines[start] ?? "")?.[2] ?? "").replace(OPEN, "").trim(),
      body: lines
        .slice(start + 1, end)
        .join("\n")
        .trim(),
    }));
  });
}
