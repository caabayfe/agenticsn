import { DocumentationSourceError } from "./errors";
import { fieldsOf, isFields, textOf } from "./fields";
import { VIEWS, type View } from "./views";

// Where a reader works: the Employee Center, Virtual Agent, the workspace, the classic form…
export interface Surface {
  readonly id: string;
  readonly name: string;
  // The mirror record behind it (<table>/<sys_id>), when it has one.
  readonly record?: string;
}

// A group of employee pages for one thing employees want to do (ADR-0037).
export interface EmployeeTask {
  readonly title: string;
  readonly summary: string;
  // <process>/<topic> of Use or Understand pages.
  readonly pages: readonly string[];
}

// The employee guide's home: where employees start, then their tasks (ADR-0037).
export interface EmployeeGuide {
  readonly title: string;
  readonly intro: string;
  readonly start: readonly string[];
  readonly tasks: readonly EmployeeTask[];
}

export interface SiteConfig {
  readonly title: string;
  // The instance whose mirror the pages are verified against.
  readonly instance: string;
  readonly footer: string;
  readonly surfaces: Readonly<Record<View, readonly Surface[]>>;
  // Platform words end users shouldn't meet, in addition to the built-in checks.
  readonly vocabulary: readonly string[];
  readonly employees?: EmployeeGuide;
}

function surface(raw: unknown): Surface {
  if (!isFields(raw)) {
    const id = textOf(raw) ?? "";
    return { id, name: id };
  }
  const id = textOf(raw["id"]) ?? "";
  const record = textOf(raw["record"]);
  return {
    id,
    name: textOf(raw["name"]) ?? id,
    ...(record === undefined ? {} : { record }),
  };
}

function surfacesOf(raw: unknown): Readonly<Record<View, readonly Surface[]>> {
  const fields = fieldsOf(raw);
  const of = (view: View) => {
    const items = fields[view];
    return Array.isArray(items) ? items.map(surface).filter((item) => item.id !== "") : [];
  };
  return { user: of(VIEWS[0]), operator: of(VIEWS[1]) };
}

const textsOf = (raw: unknown): readonly string[] =>
  Array.isArray(raw) ? raw.map((item) => textOf(item) ?? "").filter((item) => item !== "") : [];

function task(raw: unknown): EmployeeTask {
  const fields = fieldsOf(raw);
  const title = textOf(fields["title"]);
  if (title === undefined) {
    throw new DocumentationSourceError("site.yaml", "each employees task needs title");
  }
  return { title, summary: textOf(fields["summary"]) ?? "", pages: textsOf(fields["pages"]) };
}

function employeeGuide(raw: unknown): EmployeeGuide {
  const fields = fieldsOf(raw);
  const title = textOf(fields["title"]);
  if (title === undefined) {
    throw new DocumentationSourceError("site.yaml", "employees needs title");
  }
  const tasks = fields["tasks"];
  return {
    title,
    intro: textOf(fields["intro"]) ?? "",
    start: textsOf(fields["start"]),
    tasks: Array.isArray(tasks) ? tasks.map(task) : [],
  };
}

export function parseSiteConfig(raw: unknown): SiteConfig {
  const fields = fieldsOf(raw);
  const title = textOf(fields["title"]);
  const instance = textOf(fields["instance"]);
  if (title === undefined || instance === undefined) {
    throw new DocumentationSourceError("site.yaml", "needs title and instance");
  }
  const vocabulary = fields["vocabulary"];
  return {
    title,
    instance,
    footer: textOf(fields["footer"]) ?? "",
    surfaces: surfacesOf(fields["surfaces"]),
    vocabulary: Array.isArray(vocabulary) ? vocabulary.map(String) : [],
    ...(fields["employees"] === undefined ? {} : { employees: employeeGuide(fields["employees"]) }),
  };
}
