import { attributes, byPosition, isDefaultView, type LayoutView } from "./layout-xml";
import type { LoadStamp } from "./load-stamp";

// A form's related lists as the platform records them: one composite "Related Lists" update
// holding the related list record and every entry (ADR-0030). The SDK has no plugin for it, and
// its one-record-per-row form cannot update an entry (spike S15: "invalid scope"), so this is the
// platform's own form: the update pdi2 recorded in S15 is the test fixture. Loading it makes the
// platform recreate the list and its entries under new sys_ids, as its related list editor does.
// Pure.

export interface RelatedListEntry {
  readonly sysId: string;
  // <table>.<reference field>, or REL:<relationship sys_id>.
  readonly relatedList: string;
  readonly position: string;
  readonly filter: string;
  readonly orderBy: string;
  readonly groupByField: string;
}

export interface RelatedListLayout {
  readonly sysId: string;
  readonly table: string;
  readonly view: LayoutView;
  readonly domain: string;
  readonly entries: readonly RelatedListEntry[];
}

// sys_ui_related_<table>_<view name, or null>[_<domain>], as for a list.
export function relatedListUpdateName(layout: RelatedListLayout): string {
  const view = isDefaultView(layout.view) ? "null" : layout.view.name;
  const name = ["sys_ui_related", layout.table, view].join("_");
  return layout.domain === "global" ? name : `${name}_${layout.domain}`;
}

const ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const text = (value: string) => value.replace(/[&<>]/g, (c) => ESCAPES[c] ?? c);
// The platform's compact form: <x/> when empty.
const tag = (name: string, value: string, attrs = "") =>
  value === "" ? `<${name}${attrs}/>` : `<${name}${attrs}>${text(value)}</${name}>`;

type Scope = { readonly name: string; readonly sysId: string };

function entryTags(layout: RelatedListLayout): string[] {
  const listId = attributes([
    ["display_value", ""],
    ["name", layout.table],
    ["sys_domain", layout.domain],
    ["view", layout.view.sysId],
  ]);
  return [...layout.entries]
    .sort(byPosition)
    .map((e) =>
      [
        '<sys_ui_related_list_entry action="INSERT_OR_UPDATE">',
        tag("filter", e.filter),
        tag("group_by_field", e.groupByField),
        tag("list_id", layout.sysId, listId),
        tag("order_by", e.orderBy),
        tag("position", e.position),
        tag("related_list", e.relatedList),
        tag("sys_class_name", "sys_ui_related_list_entry"),
        tag("sys_id", e.sysId),
        "</sys_ui_related_list_entry>",
      ].join(""),
    );
}

function recordTag(layout: RelatedListLayout, scope: Scope, stamp?: LoadStamp): string {
  const defaultView = isDefaultView(layout.view);
  const view = attributes([
    ["display_value", defaultView ? layout.view.sysId : layout.view.name],
    ["name", defaultView ? "NULL" : layout.view.name],
  ]);
  return [
    '<sys_ui_related_list action="INSERT_OR_UPDATE">',
    ...["calculated_name", "filter"].map((f) => tag(f, "")),
    tag("name", layout.table),
    ...["order_by", "position", "related_list"].map((f) => tag(f, "")),
    tag("sys_class_name", "sys_ui_related_list"),
    tag("sys_domain", layout.domain),
    tag("sys_id", layout.sysId),
    ...["sys_name", "sys_policy"].map((f) => tag(f, "")),
    tag("sys_scope", scope.sysId, attributes([["display_value", scope.name]])),
    tag("sys_update_name", relatedListUpdateName(layout)),
    tag("sys_user", ""),
    tag("view", layout.view.sysId, view),
    tag("view_name", ""),
    ...(stamp === undefined
      ? []
      : [tag("sys_mod_count", stamp.modCount), tag("sys_updated_on", stamp.updatedOn)]),
    "</sys_ui_related_list>",
  ].join("");
}

export function relatedListLayoutXml(
  layout: RelatedListLayout,
  scope: Scope,
  stamp?: LoadStamp,
): string {
  const root = attributes([
    ["sys_domain", layout.domain],
    ["table", layout.table],
    ["version", "3"],
    ["view", isDefaultView(layout.view) ? "" : layout.view.name],
  ]);
  const body = `${entryTags(layout).join("")}${recordTag(layout, scope, stamp)}`;
  return `<?xml version="1.0" encoding="UTF-8"?><record_update><sys_ui_related${root}>${body}</sys_ui_related></record_update>`;
}
