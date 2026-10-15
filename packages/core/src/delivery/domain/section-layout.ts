import {
  attributes,
  byPosition,
  compositeUpdate,
  element,
  INSERT_OR_UPDATE,
  isDefaultView,
  type LayoutView,
} from "./layout-xml";

// A form section as the platform records it: one composite "Form Layout" update holding the
// section and every field, separator and formatter on it (ADR-0030). The form is the one the
// ServiceNow SDK's Form() writes for each section (form-plugin, SDK 4.13.6); a contract test in
// the cli package compares the two. Pure.

export interface SectionElement {
  readonly sysId: string;
  // A field, or a layout marker such as .split and .begin_split.
  readonly element: string;
  readonly position: string;
  readonly type: string;
  readonly formatter: string;
}

export interface SectionLayout {
  readonly sysId: string;
  readonly table: string;
  readonly caption: string;
  readonly view: LayoutView;
  readonly domain: string;
  // "true" or "false".
  readonly header: string;
  readonly title: string;
  readonly roles: string;
  readonly elements: readonly SectionElement[];
}

export const sectionUpdateName = (section: { readonly sysId: string }) =>
  `sys_ui_section_${section.sysId}`;

type Scope = { readonly name: string; readonly sysId: string };

function elementRows(section: SectionLayout): string[] {
  const reference = attributes([
    ["caption", section.caption],
    ["display_value", section.caption],
    ["name", section.table],
    ["sys_domain", section.domain],
    ["view", section.view.sysId],
  ]);
  return [...section.elements]
    .sort(byPosition)
    .flatMap((e) => [
      `    <sys_ui_element${INSERT_OR_UPDATE}>`,
      element("      ", "element", e.element),
      element("      ", "position", e.position),
      element("      ", "sys_id", e.sysId),
      element("      ", "sys_ui_formatter", e.formatter),
      element("      ", "sys_ui_section", section.sysId, reference),
      element("      ", "sys_user", ""),
      element("      ", "type", e.type),
      "    </sys_ui_element>",
    ]);
}

function sectionRecord(section: SectionLayout, scope: Scope): string[] {
  const view = isDefaultView(section.view)
    ? attributes([
        ["name", "NULL"],
        ["display_value", section.view.sysId],
      ])
    : attributes([
        ["name", section.view.name],
        ["display_value", section.view.name],
      ]);
  return [
    `    <sys_ui_section${INSERT_OR_UPDATE}>`,
    element("      ", "caption", section.caption),
    element("      ", "header", section.header),
    element("      ", "name", section.table),
    element("      ", "roles", section.roles),
    element("      ", "sys_domain", section.domain),
    element("      ", "sys_id", section.sysId),
    element("      ", "sys_scope", scope.sysId, attributes([["display_value", scope.name]])),
    element("      ", "sys_user", ""),
    element("      ", "title", section.title),
    element("      ", "view_name", ""),
    element("      ", "view", section.view.sysId, view),
    "    </sys_ui_section>",
  ];
}

export function sectionLayoutXml(section: SectionLayout, scope: Scope): string {
  const root = attributes([
    ["caption", section.caption],
    ["section_id", section.sysId],
    ["sys_domain", section.domain],
    ["table", section.table],
    ["view", isDefaultView(section.view) ? "" : section.view.name],
  ]);
  return compositeUpdate("sys_ui_section", root, [
    ...elementRows(section),
    ...sectionRecord(section, scope),
  ]);
}
