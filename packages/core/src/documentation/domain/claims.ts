import type { DocPage } from "./page";

// What a piece of evidence supports on a page (ADR-0039): each block that cites it, with its
// heading and its reader, so a change can say which sentences it may make wrong and who reads
// them.

export const READERS = ["employees", "operators", "everyone", "platform"] as const;
export type Reader = (typeof READERS)[number];

export interface Claim {
  readonly heading: string;
  readonly reader: Reader;
  readonly text: string;
}

const MAX_TEXT = 240;
const HEADING = /^(#{1,6})\s+(.*)$/;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const FENCE = /^(```|~~~)/;
const MARK = /\{for=([A-Za-z-]+)\}/;

interface Block {
  readonly heading: string;
  readonly view: string | undefined;
  readonly text: string;
}

const cleanHeading = (text: string) =>
  text
    .replace(/\s*\{(?:for|label)=[^}]*\}/g, "")
    .replace(/[*_`]/g, "")
    .trim();

// Markdown to plain words: no citations, labels, link targets, emphasis or table pipes.
function plainText(text: string): string {
  const cells = text.trimStart().startsWith("|")
    ? text
        .split("|")
        .map((cell) => cell.trim())
        .filter((cell) => cell !== "" && !/^\[E\d+\]$/.test(cell))
        .join(" · ")
    : text;
  const plain = cells
    .replace(/\s*\[E\d+\]/g, "")
    .replace(/\s*\{label=[^}]*\}/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__|[*`]/g, "")
    .replace(ITEM, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length <= MAX_TEXT ? plain : `${plain.slice(0, MAX_TEXT - 1).trimEnd()}…`;
}

interface Section {
  readonly level: number;
  readonly title: string;
  readonly view: string | undefined;
}

// A line by what it does to the blocks: a heading, a break (blank, table rule, code), the start
// of a list item, a table row (a block of its own), or text that continues the current block.
type Line =
  | ({ readonly kind: "heading" } & Section)
  | { readonly kind: "break" }
  | { readonly kind: "item" | "row" | "text"; readonly text: string };

const RULE_ROW = /^\s*\|?[\s:|-]*-[\s:|-]*$/;

function lineOf(text: string): Line {
  const heading = HEADING.exec(text);
  if (heading !== null) {
    const title = heading[2] ?? "";
    const view = MARK.exec(title)?.[1];
    return { kind: "heading", level: heading[1]?.length ?? 1, title: cleanHeading(title), view };
  }
  if (text.trim() === "" || RULE_ROW.test(text)) return { kind: "break" };
  if (ITEM.test(text)) return { kind: "item", text };
  return { kind: text.trimStart().startsWith("|") ? "row" : "text", text };
}

// The page's lines outside code blocks; a code block breaks the block around it.
function linesOf(body: string): readonly Line[] {
  let fence: string | null = null;
  return body.split("\n").map((text): Line => {
    const opening = FENCE.exec(text)?.[1];
    if (fence === null && opening === undefined) return lineOf(text);
    fence = fence === null ? (opening ?? null) : text.startsWith(fence) ? null : fence;
    return { kind: "break" };
  });
}

// The page's blocks: paragraphs, list items (with their continuation lines) and table rows,
// each under the innermost heading and the nearest {for=…} view.
function blocksOf(page: DocPage): readonly Block[] {
  const blocks: Block[] = [];
  const headings: Section[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) {
      const view = [...headings].reverse().find((item) => item.view !== undefined)?.view;
      const heading = headings.at(-1)?.title ?? page.title;
      blocks.push({ heading, view, text: current.join(" ") });
    }
    current = [];
  };
  for (const line of linesOf(page.body)) {
    if (line.kind !== "text") flush();
    if (line.kind === "heading") {
      while ((headings.at(-1)?.level ?? 0) >= line.level) headings.pop();
      headings.push(line);
    } else if (line.kind !== "break") {
      current.push(line.text);
    }
    if (line.kind === "row") flush();
  }
  flush();
  return blocks;
}

function readerOf(page: DocPage, view: string | undefined): Reader {
  if (page.section === "use") return "employees";
  if (page.section === "operate") return "operators";
  if (page.section === "configure") return "platform";
  return view === "user" ? "employees" : view === "operator" ? "operators" : "everyone";
}

// The claims on a page that cite any of these evidence ids, in page order.
export function claimsOf(page: DocPage, ids: readonly string[]): readonly Claim[] {
  const cites = (text: string) => ids.some((id) => text.includes(`[${id}]`));
  return blocksOf(page)
    .filter((block) => cites(block.text.replace(/`[^`]*`/g, "")))
    .map((block) => ({
      heading: block.heading,
      reader: readerOf(page, block.view),
      text: plainText(block.text),
    }));
}
