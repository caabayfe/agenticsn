import { DocumentationSourceError } from "./errors";
import { type Evidence, parseEvidence } from "./evidence";
import { type Fields, fieldsOf } from "./fields";
import { isView, viewMarks } from "./views";

// The sections of a process (spec 010a): Understand is shared by end users and operators and
// shown to each in their own view; Use is for end users, Operate for operators, Configure for
// the platform team.
export const SECTIONS = ["understand", "use", "operate", "configure"] as const;
export type Section = (typeof SECTIONS)[number];

export interface DocPage {
  // Relative to documentation/: processes/<process>/<section>/<topic>.md.
  readonly path: string;
  readonly process: string;
  readonly section: Section;
  // A shared topic (understand), a capability (use, operate), or any configured subject.
  readonly topic: string;
  readonly title: string;
  readonly reviewed?: string;
  readonly evidence: readonly Evidence[];
  readonly body: string;
}

export interface PageProblem {
  readonly kind:
    | "unknown-citation"
    | "uncited-evidence"
    | "no-evidence"
    | "misplaced-view"
    | "unknown-view";
  readonly page: string;
  readonly detail: string;
}

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n?---\r?\n?/;

export function splitFrontMatter(source: string): {
  readonly frontMatter: string | null;
  readonly body: string;
} {
  const match = FRONT_MATTER.exec(source);
  if (match === null) {
    return { frontMatter: null, body: source };
  }
  const yaml = match[1] ?? "";
  return {
    frontMatter: yaml.endsWith("\n") ? yaml : `${yaml}\n`,
    body: source.slice(match[0].length),
  };
}

function required(path: string, fields: Fields, name: string): string {
  const value = fields[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new DocumentationSourceError(path, `front matter needs ${name}`);
  }
  return value.trim();
}

function optional(fields: Fields, name: string): string | undefined {
  const value = fields[name];
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function isSection(value: string): value is Section {
  return (SECTIONS as readonly string[]).includes(value);
}

const PAGE_PATH = /^processes\/([a-z][a-z0-9-]*)\/([a-z]+)\/([a-z][a-z0-9-]*)\.md$/;

export function parseDocPage(
  path: string,
  source: { readonly frontMatter: unknown; readonly body: string },
): DocPage {
  const match = PAGE_PATH.exec(path);
  const section = match?.[2];
  if (
    match === null ||
    match[1] === undefined ||
    match[3] === undefined ||
    section === undefined ||
    !isSection(section)
  ) {
    throw new DocumentationSourceError(
      path,
      `pages are processes/<process>/<section>/<topic>.md, the section one of ${SECTIONS.join(", ")}`,
    );
  }
  const fields = fieldsOf(source.frontMatter);
  const reviewed = optional(fields, "reviewed");
  return {
    path,
    process: match[1],
    section,
    topic: match[3],
    title: required(path, fields, "title"),
    ...(reviewed === undefined ? {} : { reviewed }),
    evidence: parseEvidence(path, fields["evidence"]),
    body: source.body,
  };
}

// The Markdown without code spans and fenced blocks, where brackets are not citations.
export function proseOf(body: string): string {
  return body.replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, "").replace(/`[^`\n]*`/g, "");
}

export function citationsOf(body: string): readonly string[] {
  const found = [...proseOf(body).matchAll(/\[(E\d+)\]/g)].map((match) => match[1] ?? "");
  return [...new Set(found)];
}

export function pageProblems(page: DocPage): readonly PageProblem[] {
  const cited = citationsOf(page.body);
  const listed = new Set(page.evidence.map((item) => item.id));
  const problems: PageProblem[] = cited
    .filter((id) => !listed.has(id))
    .map((id) => ({ kind: "unknown-citation", page: page.path, detail: id }));
  for (const item of page.evidence) {
    if (!cited.includes(item.id)) {
      problems.push({ kind: "uncited-evidence", page: page.path, detail: item.id });
    }
  }
  if (page.section === "configure" && page.evidence.length === 0) {
    problems.push({ kind: "no-evidence", page: page.path, detail: page.topic });
  }
  for (const mark of viewMarks(proseOf(page.body))) {
    if (!isView(mark)) {
      problems.push({ kind: "unknown-view", page: page.path, detail: mark });
    } else if (page.section !== "understand") {
      problems.push({ kind: "misplaced-view", page: page.path, detail: mark });
    }
  }
  return problems;
}
