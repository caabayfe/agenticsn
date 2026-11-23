import { canonicalJson } from "../../kernel/canonical-json";
import { compareUnit, isComparedField } from "./compare";
import {
  compiledFields,
  exportedDefaultDifferences,
  exportedDefaults,
  orderedAttributes,
} from "./compiled-values";
import type { UnitRecord } from "./unit";
import { keyedReference, namedField } from "./values";

// Publish changes lifecycle fields, not the authored trigger, actions or inputs.
const PUBLISH_FIELDS = new Set(["active", "status", "version", "state", "label_cache"]);

function jsonValue(value: string): string {
  if (!/^[\s]*[[{]/.test(value)) return value;
  try {
    return canonicalJson(JSON.parse(value));
  } catch {
    return value;
  }
}

function normalized(record: UnitRecord, publishedHead: boolean): UnitRecord {
  const lifecycle =
    publishedHead &&
    (record.table === "sys_hub_flow" || record.table === "sys_hub_action_type_definition");
  const fields = Object.fromEntries(
    Object.entries(record.fields)
      .filter(([field]) => !lifecycle || !PUBLISH_FIELDS.has(field))
      .map(([field, value]) => [
        field,
        field === "attributes" && record.table.startsWith("sys_hub_")
          ? orderedAttributes(value)
          : jsonValue(value),
      ]),
  );
  return { ...record, fields };
}

export function instanceFields(record: UnitRecord): Readonly<Record<string, string>> {
  const fields: Record<string, string> = { ...record.fields };
  for (const [field, name] of Object.entries(record.referenceNames)) {
    fields[namedField(record.table, field)] = name === "NULL" ? "" : name;
  }
  for (const [field, value] of Object.entries(record.fields)) {
    for (const [key, held] of keyedReference(value) ?? []) fields[`${field}.${key}`] = held;
  }
  return fields;
}

// A record as a mismatch names it: its table, and its ID unless it is the unit's head.
export const rowLabel = (record: UnitRecord, head: boolean): string =>
  head || record.sysId === "" ? record.table : `${record.table} [${record.sysId}]`;

// Where a captured (or live) record disagrees with the built one: names only, never values,
// which may be long or sensitive. Empty when the record agrees.
export function recordDifferences(
  wanted: UnitRecord,
  actual: UnitRecord,
  head: boolean,
  references: ReadonlyMap<string, string> = new Map(),
): string[] {
  const label = rowLabel(wanted, head);
  if (wanted.table !== actual.table || wanted.action !== actual.action)
    return [`${label}: held as ${actual.action} of ${actual.table}`];
  const defaults = exportedDefaultDifferences(wanted, actual);
  if (defaults.length > 0) return defaults.map((field) => `${label}.${field}`);
  const built = normalized(exportedDefaults(wanted, actual), head);
  const captured = normalized(
    { ...actual, fields: compiledFields(wanted, actual, references) },
    head,
  );
  // A missing payload field is missing evidence, unlike a live Table API column absent on an
  // older release. Never let compareUnit's compatibility handling turn it into agreement.
  const absent = Object.keys(built.fields).filter(
    (field) => isComparedField(built.table, field) && captured.fields[field] === undefined,
  );
  if (absent.length > 0) return absent.map((field) => `${label}.${field} (absent)`);
  return compareUnit(
    { updateName: "", file: "", head: built, children: [] },
    { head: instanceFields(captured), children: [], version: "", foreignRows: 0 },
  ).map((d) => (d.kind === "field" ? `${label}.${d.field}` : `${d.table} rows`));
}

export const recordAgrees = (
  wanted: UnitRecord,
  actual: UnitRecord,
  head: boolean,
  references: ReadonlyMap<string, string> = new Map(),
): boolean => recordDifferences(wanted, actual, head, references).length === 0;
