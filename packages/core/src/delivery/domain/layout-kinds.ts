// The layouts push delivers whole (ADR-0029, ADR-0030): a record and its child rows, loaded as one
// update the platform records. Each kind says which rows belong to it, what of the record and the
// rows the update carries, and what identifies it. Pure data.

export type LayoutKind = "list" | "section" | "form" | "related";

export interface LayoutKindSpec {
  readonly kind: LayoutKind;
  // The record's class, and the folder its files are in.
  readonly table: string;
  // The child rows' table, and the field naming the record they belong to.
  readonly rows: string;
  readonly parentField: string;
  // Row fields the update carries, besides sys_id and the parent field.
  readonly rowFields: readonly string[];
  // Record fields that, with the domain, identify the layout: changing one is a new layout.
  readonly identity: readonly string[];
  // Other record fields the update carries.
  readonly recordFields: readonly string[];
  // A row field whose value may appear once only.
  readonly unique: string | null;
  // The row field the plan shows for each row.
  readonly label: string;
  // Row fields that hold "true" or "false".
  readonly booleans: readonly string[];
  // Record fields that, when set, mean the layout is not one push delivers.
  readonly refused: readonly { readonly fields: readonly string[]; readonly reason: string }[];
  // What the plan and its problems call it.
  readonly noun: string;
  // The platform records the update only when the rows change: a change to the record's own
  // fields alone is applied but never recorded (a form section on pdi2, ADR-0030).
  readonly recordedWithRowsOnly?: true;
}

const PERSONAL = (noun: string) => ({
  fields: ["sys_user"],
  reason: `personal ${noun}s (sys_user set) are never pushed`,
});

export const LAYOUT_KINDS: readonly LayoutKindSpec[] = [
  {
    kind: "list",
    table: "sys_ui_list",
    rows: "sys_ui_list_element",
    parentField: "list_id",
    rowFields: ["element", "position", "sum", "max_value", "min_value", "average_value"],
    identity: ["name", "view"],
    recordFields: [],
    unique: "element",
    label: "element",
    booleans: ["sum", "max_value", "min_value", "average_value"],
    refused: [
      PERSONAL("list layout"),
      {
        fields: ["parent", "relationship", "element"],
        reason:
          "related list layouts (parent, relationship or element set) are not pushed yet: change them on the instance",
      },
    ],
    noun: "list layout",
  },
  {
    kind: "section",
    table: "sys_ui_section",
    rows: "sys_ui_element",
    parentField: "sys_ui_section",
    rowFields: ["element", "position", "type", "sys_ui_formatter"],
    identity: ["name", "caption", "view"],
    recordFields: ["header", "title", "roles"],
    unique: null,
    label: "element",
    booleans: [],
    refused: [PERSONAL("form layout")],
    noun: "form section",
    recordedWithRowsOnly: true,
  },
  {
    kind: "form",
    table: "sys_ui_form",
    rows: "sys_ui_form_section",
    parentField: "sys_ui_form",
    rowFields: ["position", "sys_ui_section"],
    identity: ["name", "view"],
    recordFields: ["roles"],
    unique: "sys_ui_section",
    label: "sys_ui_section",
    booleans: [],
    refused: [PERSONAL("form")],
    noun: "form",
  },
  {
    kind: "related",
    table: "sys_ui_related_list",
    rows: "sys_ui_related_list_entry",
    parentField: "list_id",
    rowFields: ["related_list", "position", "filter", "order_by", "group_by_field"],
    identity: ["name", "view"],
    recordFields: [],
    unique: "related_list",
    label: "related_list",
    booleans: [],
    refused: [PERSONAL("related lists layout")],
    noun: "related lists layout",
  },
];

// Each kind's record class.
export const KIND_TABLE: Readonly<Record<LayoutKind, string>> = {
  list: "sys_ui_list",
  section: "sys_ui_section",
  form: "sys_ui_form",
  related: "sys_ui_related_list",
};

export const layoutKindOf = (table: string): LayoutKindSpec | undefined =>
  LAYOUT_KINDS.find((spec) => spec.table === table);
