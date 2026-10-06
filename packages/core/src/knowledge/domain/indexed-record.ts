import { BEHAVIOR_CLASSES, behaviorTable, orderOf, type Phase } from "./behavior";

// Fields worth keeping in the index to describe a record without opening it.
const KEY_FIELDS = [
  "action_delete",
  "action_insert",
  "action_query",
  "action_update",
  "client",
  "column_label",
  "element",
  "event_name",
  "field_name",
  "internal_type",
  "mandatory",
  "operation",
  "reference",
  "type",
  "ui_type",
  "when",
];

export interface IndexedRecord {
  // Relative to instances/<name>/metadata, without .yaml.
  readonly base: string;
  readonly sysId: string;
  readonly className: string;
  readonly scope: string;
  readonly name: string;
  readonly table: string | null;
  readonly phase: Phase | null;
  readonly order: number;
  readonly active: boolean;
  readonly updatedOn: string;
  readonly fields: Readonly<Record<string, string>>;
}

// A record file's fields as scanned: `meta` is its _meta map.
export interface RecordFields {
  readonly meta: Readonly<Record<string, string>>;
  readonly fields: Readonly<Record<string, string>>;
}

// Classes that are not behavior but belong to a table, named in one of their fields: found by
// that table (find "incident" lists the incident number record).
const TABLE_FIELDS: Readonly<Record<string, string>> = { sys_number: "category" };

const NAME_FIELDS = ["name", "sys_name", "title", "label", "element", "api_name", "id"];

function displayName(fields: Readonly<Record<string, string>>): string {
  for (const field of NAME_FIELDS) {
    const value = fields[field]?.trim();
    if (value) {
      return value;
    }
  }
  return "";
}

export function indexedRecord(base: string, record: RecordFields): IndexedRecord {
  const className = record.meta["sys_class_name"] ?? "";
  const tableField = TABLE_FIELDS[className];
  const table =
    behaviorTable(className, record.fields) ??
    ((tableField === undefined ? "" : record.fields[tableField]) || null);
  const behavior = BEHAVIOR_CLASSES[className];
  return {
    base,
    sysId: record.meta["sys_id"] ?? "",
    className,
    scope: record.meta["scope"] ?? "",
    name: behavior?.displayName?.(record.fields) ?? displayName(record.fields),
    table,
    phase: table === null || behavior === undefined ? null : behavior.phase(record.fields),
    order: orderOf(record.fields),
    active: record.fields["active"] !== "false",
    updatedOn: record.meta["sys_updated_on"] ?? record.fields["sys_updated_on"] ?? "",
    fields: Object.fromEntries(
      KEY_FIELDS.flatMap((key) =>
        record.fields[key] === undefined ? [] : [[key, record.fields[key]]],
      ),
    ),
  };
}
