import { type DocPage, SECTIONS, type Section } from "./page";
import { mapProse, SEE_LINK } from "./prose";

// Links between pages, across processes too (spec 010b): [text](see:<process>/<topic>),
// [text](see:<topic>) in the same process, [text](see:<process>/<section>/<topic>), or
// [text](see:<process>) for a process's page. docs check fails on one that leads nowhere.

export function referencesOf(markdown: string): readonly string[] {
  const found: string[] = [];
  mapProse(markdown, (prose) => {
    for (const match of prose.matchAll(SEE_LINK)) {
      found.push(match[1] ?? "");
    }
    return prose;
  });
  return found;
}

export type Resolved =
  | { readonly kind: "process"; readonly process: string }
  | { readonly kind: "page"; readonly page: DocPage };

// The sections to look in, the reader's own first: an end user's link goes to the end user's
// page when the topic has one, an operator's to the operator's.
const PREFERENCE: Readonly<Record<Section, readonly Section[]>> = {
  use: ["use", "understand", "operate", "configure"],
  understand: ["understand", "use", "operate", "configure"],
  operate: ["operate", "understand", "configure", "use"],
  configure: ["configure", "operate", "understand", "use"],
};

const isSection = (value: string): value is Section =>
  (SECTIONS as readonly string[]).includes(value);

type From = { readonly process: string; readonly section: Section };

function find(
  pages: readonly DocPage[],
  process: string,
  sections: readonly Section[],
  topic: string,
): Resolved | null {
  for (const section of sections) {
    const page = pages.find(
      (item) => item.process === process && item.section === section && item.topic === topic,
    );
    if (page !== undefined) return { kind: "page", page };
  }
  return null;
}

// see:<topic> in this process, or see:<process> for another process's page.
function resolveOne(
  name: string,
  from: From,
  pages: readonly DocPage[],
  processes: readonly string[],
): Resolved | null {
  if (processes.includes(name) && name !== from.process) {
    return { kind: "process", process: name };
  }
  const page = find(pages, from.process, PREFERENCE[from.section], name);
  return page ?? (name === from.process ? { kind: "process", process: name } : null);
}

export function resolveReference(
  target: string,
  from: From,
  pages: readonly DocPage[],
  processes: readonly string[],
): Resolved | null {
  const parts = target.split("/").filter((part) => part !== "");
  const [first = "", second = "", third = ""] = parts;
  const count = parts.length;
  if (count === 1) return resolveOne(first, from, pages, processes);
  if (!processes.includes(first)) return null;
  if (count === 2) return find(pages, first, PREFERENCE[from.section], second);
  if (count === 3 && isSection(second)) return find(pages, first, [second], third);
  return null;
}
