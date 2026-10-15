import { formLayoutXml, formUpdateName } from "./form-layout";
import { listLayoutXml, listUpdateName } from "./list-layout";
import type { PlannedLayout, Row } from "./planned-layout";
import { relatedListLayoutXml, relatedListUpdateName } from "./related-list-layout";
import { sectionLayoutXml, sectionUpdateName } from "./section-layout";

// A planned layout as the update its kind's writer produces (ADR-0029, ADR-0030). Pure.

type Scope = { readonly name: string; readonly sysId: string };
type Layout = Omit<PlannedLayout, "updateName">;

const field = (row: Row, name: string, empty = "") => row[name] || empty;
const flag = (row: Row, name: string) => field(row, name, "false");

const asList = (layout: Layout) => ({
  ...layout,
  columns: layout.rows.map((row) => ({
    sysId: field(row, "sys_id"),
    element: field(row, "element"),
    position: field(row, "position"),
    sum: flag(row, "sum"),
    maxValue: flag(row, "max_value"),
    minValue: flag(row, "min_value"),
    averageValue: flag(row, "average_value"),
  })),
});

const asSection = (layout: Layout) => ({
  ...layout,
  caption: field(layout.fields, "caption"),
  header: flag(layout.fields, "header"),
  title: flag(layout.fields, "title"),
  roles: field(layout.fields, "roles"),
  elements: layout.rows.map((row) => ({
    sysId: field(row, "sys_id"),
    element: field(row, "element"),
    position: field(row, "position"),
    type: field(row, "type"),
    formatter: field(row, "sys_ui_formatter"),
  })),
});

const asForm = (layout: Layout) => ({
  ...layout,
  roles: field(layout.fields, "roles"),
  sections: layout.rows.map((row) => {
    const section = field(row, "sys_ui_section");
    const ref = layout.sections[section];
    return {
      sysId: field(row, "sys_id"),
      position: field(row, "position"),
      section: {
        sysId: section,
        caption: ref?.caption ?? "",
        domain: ref?.domain ?? layout.domain,
        viewSysId: ref?.viewSysId ?? layout.view.sysId,
      },
    };
  }),
});

const asRelated = (layout: Layout) => ({
  ...layout,
  entries: layout.rows.map((row) => ({
    sysId: field(row, "sys_id"),
    relatedList: field(row, "related_list"),
    position: field(row, "position"),
    filter: field(row, "filter"),
    orderBy: field(row, "order_by"),
    groupByField: field(row, "group_by_field"),
  })),
});

export function layoutUpdateName(layout: Layout): string {
  switch (layout.kind) {
    case "list":
      return listUpdateName(asList(layout));
    case "section":
      return sectionUpdateName(layout);
    case "form":
      return formUpdateName(layout);
    case "related":
      return relatedListUpdateName(asRelated(layout));
  }
}

export function layoutXml(layout: Layout, scope: Scope): string {
  switch (layout.kind) {
    case "list":
      return listLayoutXml(asList(layout), scope);
    case "section":
      return sectionLayoutXml(asSection(layout), scope);
    case "form":
      return formLayoutXml(asForm(layout), scope);
    case "related":
      return relatedListLayoutXml(asRelated(layout), scope);
  }
}
