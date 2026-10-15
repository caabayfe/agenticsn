import {
  attributes,
  compositeUpdate,
  element,
  INSERT_OR_UPDATE,
  isDefaultView,
  type LayoutView,
} from "./layout-xml";

export { DEFAULT_VIEW } from "./layout-xml";

// A list layout as the platform records it: one composite "List Layout" update holding the list
// and every column (ADR-0029). The form is the one the ServiceNow SDK's List() builds
// (list-plugin, SDK 4.13.6); a contract test in the cli package compares the two. Pure.

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
  // The Default view's name is not used.
  readonly view: LayoutView;
  // "global" or the domain's sys_id.
  readonly domain: string;
  readonly columns: readonly ListColumn[];
}

const isDefault = (layout: ListLayout) => isDefaultView(layout.view);

// sys_ui_list_<table>_<view name, or null for the Default view>[_<domain>]. The platform keeps
// the view name's case (sys_ui_list_<table>_Mobile on pdi2); the SDK lower-cases its file name.
export function listUpdateName(layout: ListLayout): string {
  const view = isDefault(layout) ? "null" : layout.view.name;
  const name = ["sys_ui_list", layout.table, view].join("_");
  return layout.domain === "global" ? name : `${name}_${layout.domain}`;
}

// Columns in the order the list shows them.
export const byPosition = (a: ListColumn, b: ListColumn) =>
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
      `    <sys_ui_list_element${INSERT_OR_UPDATE}>`,
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
  return compositeUpdate("sys_ui_list", root, [
    ...columns,
    `    <sys_ui_list${INSERT_OR_UPDATE}>`,
    element("      ", "sys_id", layout.sysId),
    element("      ", "sys_scope", scope.sysId, attributes([["display_value", scope.name]])),
    element("      ", "view", layout.view.sysId, viewName),
    element("      ", "name", layout.table),
    element("      ", "sys_domain", layout.domain),
    "    </sys_ui_list>",
  ]);
}
