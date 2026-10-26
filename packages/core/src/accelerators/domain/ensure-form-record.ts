import { type FormFieldFact, formFieldId, type SectionState } from "./ensure-form";

// Removal for form_field facts (form-field-plan.md, section 4 item 6): a fact dropped from a
// module's ensure.yaml takes its own element off the section at the next install, and never
// another one. The install records, per module, the sections it added fields to; a section in
// that record is read again, and an element is the module's only when its sys_id is the one the
// module would derive for that field, so the client's elements and other modules' never match.
// Pure: the record comes in as text, the sections as SectionState.

export interface FormSectionRecord {
  readonly module: string;
  readonly sysId: string;
  readonly table: string;
  // The view and section as the module's facts named them: the derived ids are built from these.
  readonly view: string;
  readonly caption: string;
}

const STRING_KEYS = ["module", "sysId", "table", "view", "caption"] as const;

const fieldsOf = (value: unknown): Readonly<Record<string, unknown>> =>
  value !== null && typeof value === "object" ? Object.fromEntries(Object.entries(value)) : {};

const isRecord = (value: unknown): value is FormSectionRecord => {
  const entry = fieldsOf(value);
  return STRING_KEYS.every((key) => typeof entry[key] === "string");
};

// The recorded sections; none before the first install that added a field. An unreadable record
// counts as none: what was the module's is never guessed, so nothing is removed.
export function formRecordOf(text: string | null): FormSectionRecord[] {
  if (text === null) return [];
  try {
    const sections = fieldsOf(JSON.parse(text))["sections"];
    return Array.isArray(sections) ? sections.filter(isRecord) : [];
  } catch {
    return [];
  }
}

const keyOf = (r: FormSectionRecord) => `${r.module}\u0000${r.sysId}`;

// The record as committed: one entry per module and section, sorted, so it is the same text
// for the same content.
export function formRecordText(records: readonly FormSectionRecord[]): string {
  const unique = new Map(records.map((r) => [keyOf(r), r]));
  const sections = [...unique.values()]
    .sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
    .map((r) => ({
      module: r.module,
      sysId: r.sysId,
      table: r.table,
      view: r.view,
      caption: r.caption,
    }));
  return `${JSON.stringify({ sections }, null, 2)}\n`;
}

// A recorded section as a fact to read it by: its table, view and caption.
export const probeOf = (record: FormSectionRecord): FormFieldFact => ({
  capability: record.module,
  kind: "form_field",
  table: record.table,
  view: record.view,
  section: record.caption,
  field: "",
  after: "",
  note: "",
});

// The module's elements on a recorded section that none of its facts makes any more.
export function droppedElements(
  pack: string,
  record: FormSectionRecord,
  state: SectionState,
  facts: readonly FormFieldFact[],
): string[] {
  if (state.sysId === null) return [];
  const kept = new Set(facts.map((fact) => formFieldId(pack, fact)));
  const probe = probeOf(record);
  return state.elements
    .filter((element) => {
      const own = formFieldId(pack, { ...probe, field: element.element });
      return element.sysId === own && !kept.has(own);
    })
    .map((element) => element.sysId);
}
