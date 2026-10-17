import { DocumentationSourceError } from "./errors";
import { type Evidence, parseEvidence } from "./evidence";
import { type Fields, fieldsOf } from "./fields";

export const AUDIENCES = ["guide", "technical"] as const;
export type Audience = (typeof AUDIENCES)[number];

export interface DocPage {
  // Relative to documentation/: processes/<process>/<capability>.<audience>.md.
  readonly path: string;
  readonly process: string;
  // A capability of the process, or "overview" for the process's own page.
  readonly capability: string;
  readonly audience: Audience;
  readonly title: string;
  readonly reviewed?: string;
  readonly evidence: readonly Evidence[];
  readonly body: string;
}

export interface PageProblem {
  readonly kind: "unknown-citation" | "uncited-evidence" | "no-evidence";
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

function isAudience(value: string): value is Audience {
  return (AUDIENCES as readonly string[]).includes(value);
}

const PAGE_PATH = /^processes\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)\.(guide|technical)\.md$/;

export function parseDocPage(
  path: string,
  source: { readonly frontMatter: unknown; readonly body: string },
): DocPage {
  const match = PAGE_PATH.exec(path);
  const audience = match?.[3];
  if (
    match === null ||
    match[1] === undefined ||
    match[2] === undefined ||
    audience === undefined ||
    !isAudience(audience)
  ) {
    throw new DocumentationSourceError(
      path,
      "pages are processes/<process>/<capability>.guide.md or .technical.md",
    );
  }
  const fields = fieldsOf(source.frontMatter);
  const reviewed = optional(fields, "reviewed");
  return {
    path,
    process: match[1],
    capability: match[2],
    audience,
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
  if (page.audience === "technical" && page.evidence.length === 0) {
    problems.push({ kind: "no-evidence", page: page.path, detail: page.capability });
  }
  return problems;
}
