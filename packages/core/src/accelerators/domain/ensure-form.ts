import { sha256Hex } from "../../kernel/sha256";

// Ensure rules, second kind (ADR-0042 form_field): a field a module puts on a form it does not
// own, found by table, view and section caption. A section and its elements are one update, so
// the module's build restates the section whole as the instance holds it now, the client's
// elements included, with the missing fields inserted (form-field-plan.md, decisions D1-D5).
// Pure: the instance's sections come in as SectionState.

export interface FormFieldFact {
  readonly capability: string;
  readonly kind: "form_field";
  readonly table: string;
  // The view by name: "Default view" or a view such as a workspace's "sow".
  readonly view: string;
  // The section by caption; "" is the form's first section, which has none.
  readonly section: string;
  readonly field: string;
  // The element the field goes after; "" or one the section lacks puts it at the end (D3).
  readonly after: string;
  readonly note: string;
}

export interface SectionElement {
  readonly sysId: string;
  readonly element: string;
  // "" for a field; ".split", ".end_split", ".begin_split", "formatter" or "annotation" otherwise.
  readonly type: string;
  readonly formatter: string;
  readonly position: number;
}

// One section of a form in the global domain (D4), as the instance holds it now.
export interface SectionState {
  // null when the instance has no such view or section.
  readonly sysId: string | null;
  // The application that owns the section: its build goes into that scope's project.
  readonly scope: { readonly name: string; readonly sysId: string };
  readonly table: string;
  readonly view: string;
  readonly caption: string;
  readonly title: string;
  readonly header: string;
  readonly elements: readonly SectionElement[];
  // The fields on every section of the view: one already there is left where it is.
  readonly onView: readonly string[];
}

// missing: the module adds it; present: already on the form (someone else's); ours: the
// module's element is there; absent: no such view or section on the instance.
export type FormFieldStatus = "missing" | "present" | "ours" | "absent";

const text = (entry: Readonly<Record<string, unknown>>, key: string) => {
  const value = entry[key];
  return typeof value === "string" ? value.trim() : "";
};

// A form_field entry of a module's ensure.yaml, or null with its problem named.
export function formFieldFactOf(
  capability: string,
  where: string,
  entry: Readonly<Record<string, unknown>>,
  problems: string[],
): FormFieldFact | null {
  const fact: FormFieldFact = {
    capability,
    kind: "form_field",
    table: text(entry, "table"),
    view: text(entry, "view") || "Default view",
    section: text(entry, "section"),
    field: text(entry, "field"),
    after: text(entry, "after"),
    note: text(entry, "note"),
  };
  if (!fact.table || !fact.field || !fact.note) {
    problems.push(`${where} needs table, field and note (view, section and after are optional)`);
    return null;
  }
  return fact;
}

// The module's element for a fact: the same sys_id wherever the pack is installed.
export const formFieldId = (pack: string, fact: FormFieldFact): string =>
  sha256Hex(
    [
      "ensure",
      pack,
      fact.capability,
      fact.kind,
      fact.table,
      fact.view,
      fact.section,
      fact.field,
    ].join("/"),
  ).slice(0, 32);

export function formFieldStatus(
  fact: FormFieldFact,
  state: SectionState,
  ownId: string,
): FormFieldStatus {
  if (state.sysId === null) return "absent";
  if (state.elements.some((e) => e.sysId === ownId)) return "ours";
  return state.onView.includes(fact.field) ? "present" : "missing";
}

type Placed = Omit<SectionElement, "position">;

// The section's elements as the build restates them: every one it has, in order, with each
// missing field after its `after` element, or at the end when the section lacks it.
export function placedElements(
  pack: string,
  state: SectionState,
  facts: readonly FormFieldFact[],
): { readonly elements: readonly Placed[]; readonly added: readonly string[] } {
  const elements: Placed[] = [...state.elements]
    .sort((a, b) => a.position - b.position)
    .map(({ position: _, ...element }) => element);
  const added: string[] = [];
  for (const fact of facts) {
    const sysId = formFieldId(pack, fact);
    if (formFieldStatus(fact, state, sysId) !== "missing" || added.includes(fact.field)) continue;
    const anchor = fact.after === "" ? -1 : elements.findIndex((e) => e.element === fact.after);
    const at = anchor === -1 ? elements.length : anchor + 1;
    elements.splice(at, 0, { sysId, element: fact.field, type: "", formatter: "" });
    added.push(fact.field);
  }
  return { elements, added };
}

const quote = (value: string) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

const HEADER = "import { Record } from '@servicenow/sdk/core'";

// A field row leaves its type out (the SDK refuses ''); a split marker, formatter or annotation
// keeps it, and a formatter its sys_ui_formatter (spike S-FF1).
function elementData(section: string, element: Placed, position: number): string {
  const parts = [`sys_ui_section: '${section}'`, `element: ${quote(element.element)}`];
  if (element.type !== "") parts.push(`type: ${quote(element.type)}`);
  if (element.formatter !== "") parts.push(`sys_ui_formatter: '${element.formatter}'`);
  parts.push(`position: ${position}`);
  return `{ ${parts.join(", ")} }`;
}

// The generated Fluent for one section: the section by its keys and every element it will have.
export function sectionSource(
  state: SectionState & { readonly sysId: string },
  elements: readonly Placed[],
): string {
  const lines = [
    `// Generated by snagentic accelerator install: the section "${state.caption}" of ${state.table}, ${state.view}, as the instance holds it, with the fields the modules add (ADR-0042 form_field): do not edit.`,
    HEADER,
    "",
    "Record({",
    `    $id: '${state.sysId}',`,
    "    table: 'sys_ui_section',",
    `    data: { name: ${quote(state.table)}, view: ${quote(state.view)}, caption: ${quote(state.caption)}, sys_domain: 'global', title: ${state.title === "true"}, header: ${state.header === "true"} },`,
    "})",
    "",
  ];
  elements.forEach((element, position) => {
    lines.push(
      "Record({",
      `    $id: '${element.sysId}',`,
      "    table: 'sys_ui_element',",
      `    data: ${elementData(state.sysId, element, position)},`,
      "})",
      "",
    );
  });
  return lines.join("\n");
}
