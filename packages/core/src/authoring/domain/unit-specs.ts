import type { BuiltUnit, Fields } from "./unit";
import { comparedValue } from "./values";

// How the instance's copy of a unit is found and read (ADR-0033 item 1).

export interface ChildSpec {
  readonly table: string;
  // Child field -> head field: a column's list_id is its list's sys_id; a choice's name and
  // element are its set's.
  readonly link: Readonly<Record<string, string>>;
  // Fields that identify a row within the unit. The platform gives rows new sys_ids freely.
  readonly key: readonly string[];
  // Rows whose order is part of the layout, by position.
  readonly ordered: boolean;
}

export interface UnitSpec {
  // Head fields the platform coalesces on when the sys_id differs (dictionary entries, labels,
  // layouts). Absent: the head is found by sys_id only.
  readonly coalesce?: readonly string[];
  readonly children?: ChildSpec;
  // False for units the platform compiles after the load (flows): their live copy never equals
  // the build, so only the ledger's hashes decide.
  readonly comparable: boolean;
}

const RECORD: UnitSpec = { comparable: true };
const COMPILED: UnitSpec = { comparable: false };

const SPECS: Readonly<Record<string, UnitSpec>> = {
  sys_dictionary: { coalesce: ["name", "element"], comparable: true },
  sys_documentation: { coalesce: ["name", "element", "language"], comparable: true },
  sys_choice_set: {
    coalesce: ["name", "element"],
    children: {
      table: "sys_choice",
      link: { name: "name", element: "element" },
      key: ["value", "language"],
      ordered: false,
    },
    comparable: true,
  },
  sys_ui_list: {
    coalesce: ["name", "view", "parent", "relationship", "sys_domain"],
    children: {
      table: "sys_ui_list_element",
      link: { list_id: "sys_id" },
      key: ["element"],
      ordered: true,
    },
    comparable: true,
  },
  sys_ui_section: {
    coalesce: ["name", "view", "caption", "sys_domain"],
    children: {
      table: "sys_ui_element",
      link: { sys_ui_section: "sys_id" },
      key: ["element", "type"],
      ordered: true,
    },
    comparable: true,
  },
  sys_ui_form: {
    coalesce: ["name", "view", "sys_domain"],
    children: {
      table: "sys_ui_form_section",
      link: { sys_ui_form: "sys_id" },
      key: ["sys_ui_section"],
      ordered: true,
    },
    comparable: true,
  },
  sys_hub_flow: COMPILED,
  sys_hub_action_type_definition: COMPILED,
};

export function unitSpec(table: string): UnitSpec {
  return SPECS[table] ?? RECORD;
}

// The query fields and values that find the head when its sys_id differs, or null when the head
// is found by sys_id only. A field the build left out is empty (a list with no parent); a view
// is found by its name.
export function coalesceValues(unit: BuiltUnit): Fields | null {
  const fields = unitSpec(unit.head.table).coalesce;
  if (fields === undefined) return null;
  return Object.fromEntries(fields.map((field) => comparedValue(unit.head, field).reverse()));
}

// The child rows' link values, given the head as the instance holds it.
export function childLink(spec: ChildSpec, head: Fields): Fields {
  return Object.fromEntries(
    Object.entries(spec.link).map(([child, parent]) => [child, head[parent] ?? ""]),
  );
}
