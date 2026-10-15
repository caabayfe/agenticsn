// A list layout as the platform records it: one composite "List Layout" update holding the list
// and every column (ADR-0029). The form is the one the ServiceNow SDK's List() builds
// (list-plugin, SDK 4.13.6); a contract test in the cli package compares the two. Pure.

export const DEFAULT_VIEW = "Default view";

export interface ListColumn {
  readonly sysId: string;
  readonly element: string;
  readonly position: string;
  // "true" or "false", as the mirror holds them.
  readonly sum: string;
  readonly maxValue: string;
  readonly minValue: string;
  readonly averageValue: string;
}

export interface ListLayout {
  readonly sysId: string;
  readonly table: string;
  // The Default view's sys_id is literally "Default view"; its name is not used.
  readonly view: { readonly sysId: string; readonly name: string };
  // "global" or the domain's sys_id.
  readonly domain: string;
  readonly columns: readonly ListColumn[];
}

const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};
const escapeXml = (value: string) => value.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c);
const attributes = (values: readonly (readonly [string, string])[]) =>
  values.map(([name, value]) => ` ${name}="${escapeXml(value)}"`).join("");
const element = (indent: string, name: string, text: string, attrs = "") =>
  `${indent}<${name}${attrs}>${escapeXml(text)}</${name}>`;

const isDefault = (layout: ListLayout) => layout.view.sysId === DEFAULT_VIEW;

// sys_ui_list_<table>_<view name, or null for the Default view>[_<domain>], lower case.
export function listUpdateName(layout: ListLayout): string {
  const view = isDefault(layout) ? "NULL" : layout.view.name;
  const name = ["sys_ui_list", layout.table, view].join("_").toLowerCase();
  return layout.domain === "global" ? name : `${name}_${layout.domain}`;
}

const byPosition = (a: ListColumn, b: ListColumn) =>
  Number(a.position) - Number(b.position) || (a.element < b.element ? -1 : 1);

export function listLayoutXml(
  layout: ListLayout,
  scope: { readonly name: string; readonly sysId: string },
): string {
  // The coalesce keys the platform matches the list on.
  const keys = attributes([
    ["display_value", layout.table],
    ["name", layout.table],
    ["view", layout.view.sysId],
    ["sys_domain", layout.domain],
    ["element", "NULL"],
    ["relationship", "NULL"],
    ["parent", "NULL"],
  ]);
  const columns = [...layout.columns]
    .sort(byPosition)
    .flatMap((c) => [
      '    <sys_ui_list_element action="INSERT_OR_UPDATE" apply_defaults="true">',
      element("      ", "sys_id", c.sysId),
      element("      ", "list_id", layout.sysId, keys),
      element("      ", "element", c.element),
      element("      ", "position", c.position),
      element("      ", "min_value", c.minValue),
      element("      ", "max_value", c.maxValue),
      element("      ", "average_value", c.averageValue),
      element("      ", "sum", c.sum),
      "    </sys_ui_list_element>",
    ]);
  const root = attributes([
    ["table", layout.table],
    ["parent", ""],
    ["relationship", ""],
    ["sys_domain", layout.domain],
    ["view", isDefault(layout) ? "" : layout.view.name],
  ]);
  const viewName = attributes([["name", isDefault(layout) ? "NULL" : layout.view.name]]);
  return [
    '<?xml version="1.0"?>',
    "<record_update>",
    `  <sys_ui_list${root}>`,
    ...columns,
    '    <sys_ui_list action="INSERT_OR_UPDATE" apply_defaults="true">',
    element("      ", "sys_id", layout.sysId),
    element("      ", "sys_scope", scope.sysId, attributes([["display_value", scope.name]])),
    element("      ", "view", layout.view.sysId, viewName),
    element("      ", "name", layout.table),
    element("      ", "sys_domain", layout.domain),
    "    </sys_ui_list>",
    "  </sys_ui_list>",
    "</record_update>",
  ].join("\n");
}
