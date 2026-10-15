import {
  attributes,
  byPosition,
  compositeUpdate,
  element,
  INSERT_OR_UPDATE,
  isDefaultView,
  type LayoutView,
} from "./layout-xml";

// A form as the platform records it: one composite "Form Sections" update holding the form and
// the sections it shows, in order (ADR-0030). The Table API's writes of these are recorded too,
// but delivering the form whole lets a section leave it, and keeps every layout on one route. The
// form is the one the ServiceNow SDK's Form() writes (form-plugin, SDK 4.13.6); a contract test in
// the cli package compares the two. Pure.

export interface FormSectionRef {
  // The sys_ui_form_section row.
  readonly sysId: string;
  readonly position: string;
  // The section it shows, as the platform matches it.
  readonly section: {
    readonly sysId: string;
    readonly caption: string;
    readonly domain: string;
    readonly viewSysId: string;
  };
}

export interface FormLayout {
  readonly sysId: string;
  readonly table: string;
  readonly view: LayoutView;
  readonly domain: string;
  readonly roles: string;
  readonly sections: readonly FormSectionRef[];
}

export const formUpdateName = (form: { readonly sysId: string }) =>
  `sys_ui_form_sections_${form.sysId}`;

type Scope = { readonly name: string; readonly sysId: string };

function sectionRows(form: FormLayout): string[] {
  const formRef = attributes([
    ["display_value", form.table],
    ["name", form.table],
    ["sys_domain", form.domain],
    ["view", form.view.sysId],
  ]);
  const sectionRef = (s: FormSectionRef["section"]) =>
    attributes([
      ["caption", s.caption],
      ["display_value", s.caption],
      ["name", form.table],
      ["sys_domain", s.domain],
      ["view", s.viewSysId],
    ]);
  return [...form.sections]
    .sort(byPosition)
    .flatMap((s) => [
      `    <sys_ui_form_section${INSERT_OR_UPDATE}>`,
      element("      ", "position", s.position),
      element("      ", "sys_id", s.sysId),
      element("      ", "sys_ui_form", form.sysId, formRef),
      element("      ", "sys_ui_section", s.section.sysId, sectionRef(s.section)),
      "    </sys_ui_form_section>",
    ]);
}

export function formLayoutXml(form: FormLayout, scope: Scope): string {
  const view = isDefaultView(form.view)
    ? attributes([
        ["name", "NULL"],
        ["display_value", form.view.sysId],
      ])
    : attributes([
        ["name", form.view.name],
        ["display_value", form.view.name],
      ]);
  const root = attributes([
    ["form_id", form.sysId],
    ["sys_domain", form.domain],
    ["table", form.table],
  ]);
  return compositeUpdate("sys_ui_form_sections", root, [
    ...sectionRows(form),
    `    <sys_ui_form${INSERT_OR_UPDATE}>`,
    element("      ", "name", form.table),
    element("      ", "roles", form.roles),
    element("      ", "sys_id", form.sysId),
    element("      ", "sys_scope", scope.sysId, attributes([["display_value", scope.name]])),
    element("      ", "sys_user", ""),
    element("      ", "view", form.view.sysId, view),
    element("      ", "view_name", ""),
    "    </sys_ui_form>",
  ]);
}
