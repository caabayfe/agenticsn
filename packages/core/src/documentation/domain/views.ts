// The two readers of a process (spec 010a): end users, who ask for help on the portal, and
// operators, who work on the platform. The platform team reads the Configure section.
export const VIEWS = ["user", "operator"] as const;
export type View = (typeof VIEWS)[number];

export function isView(value: string): value is View {
  return (VIEWS as readonly string[]).includes(value);
}

const MARK = /\s*\{for=([A-Za-z-]+)\}/;
const HEADING = /^(#{1,6}) /;
const FENCE = /^(```|~~~)/;

interface Line {
  readonly text: string;
  readonly code: boolean;
}

function lines(markdown: string): readonly Line[] {
  let fence: string | null = null;
  return markdown.split("\n").map((text) => {
    const opening = FENCE.exec(text)?.[1];
    if (fence === null && opening !== undefined) {
      fence = opening;
      return { text, code: true };
    }
    if (fence !== null) {
      if (text.startsWith(fence)) {
        fence = null;
      }
      return { text, code: true };
    }
    return { text, code: false };
  });
}

// The page as one reader sees it: a heading marked {for=<other reader>} is dropped with
// everything under it, up to the next heading of the same or a higher level.
export function viewOf(markdown: string, view: View): string {
  const kept: string[] = [];
  let skipping: number | null = null;
  for (const line of lines(markdown)) {
    const level = line.code ? undefined : HEADING.exec(line.text)?.[1]?.length;
    if (skipping !== null && level !== undefined && level <= skipping) {
      skipping = null;
    }
    if (skipping !== null) {
      continue;
    }
    const mark = level === undefined ? undefined : MARK.exec(line.text)?.[1];
    if (level !== undefined && mark !== undefined && mark !== view) {
      skipping = level;
      continue;
    }
    kept.push(mark === undefined ? line.text : line.text.replace(MARK, ""));
  }
  return kept.join("\n");
}

// Every {for=…} mark on a heading, in order, known or not.
export function viewMarks(markdown: string): readonly string[] {
  const marks: string[] = [];
  for (const line of lines(markdown)) {
    const mark = line.code || !HEADING.test(line.text) ? undefined : MARK.exec(line.text)?.[1];
    if (mark !== undefined && !marks.includes(mark)) {
      marks.push(mark);
    }
  }
  return marks;
}
