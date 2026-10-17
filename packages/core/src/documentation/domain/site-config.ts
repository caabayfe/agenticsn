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

export interface SiteConfig {
  readonly title: string;
  // The instance whose mirror the pages are verified against.
  readonly instance: string;
  readonly footer: string;
  readonly surfaces: Readonly<Record<View, readonly Surface[]>>;
  // Platform words end users shouldn't meet, in addition to the built-in checks.
  readonly vocabulary: readonly string[];
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
  };
}
