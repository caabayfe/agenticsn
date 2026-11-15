import { canonicalJson } from "../../kernel/canonical-json";
import { compareUnit, isComparedField } from "./compare";
import { authoredCaptureRows } from "./compiled-graph";
import { compiledFields, exportedDefaults, orderedAttributes } from "./compiled-values";
import { normalizeEmptySlaInputs } from "./empty-sla-input";
import { normalizeNativeDefaults } from "./native-input-defaults";
import { type NativeTriggerContract, withNativeTriggerInputs } from "./native-trigger-capture";
import type { BuiltUnit, InstanceCopy, UnitRecord } from "./unit";
import { unitSpec } from "./unit-specs";
import { comparedValue, keyedReference, namedField, sameValue } from "./values";

// Publish changes lifecycle fields, not the authored trigger, actions or inputs.
const PUBLISH_FIELDS = new Set(["active", "status", "version", "state", "label_cache"]);
const SNAPSHOTS = new Set(["sys_hub_flow_snapshot", "sys_hub_action_type_snapshot"]);

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

function instanceFields(record: UnitRecord): Readonly<Record<string, string>> {
  const fields: Record<string, string> = { ...record.fields };
  for (const [field, name] of Object.entries(record.referenceNames)) {
    fields[namedField(record.table, field)] = name === "NULL" ? "" : name;
  }
  for (const [field, value] of Object.entries(record.fields)) {
    for (const [key, held] of keyedReference(value) ?? []) fields[`${field}.${key}`] = held;
  }
  return fields;
}

function recordAgrees(
  wanted: UnitRecord,
  actual: UnitRecord,
  head: boolean,
  references: ReadonlyMap<string, string> = new Map(),
): boolean {
  if (wanted.table !== actual.table || wanted.action !== actual.action) return false;
  const built = normalized(exportedDefaults(wanted, actual), head);
  const captured = normalized(
    { ...actual, fields: compiledFields(wanted, actual, references) },
    head,
  );
  // A missing payload field is missing evidence, unlike a live Table API column absent on an
  // older release. Never let compareUnit's compatibility handling turn it into agreement.
  if (
    Object.keys(built.fields).some(
      (field) => isComparedField(built.table, field) && captured.fields[field] === undefined,
    )
  )
    return false;
  return (
    compareUnit(
      { updateName: "", file: "", head: built, children: [] },
      { head: instanceFields(captured), children: [], version: "", foreignRows: 0 },
    ).length === 0
  );
}

function completeChildren(built: BuiltUnit, actual: BuiltUnit): boolean {
  const spec = unitSpec(built.head.table).children;
  if (spec === undefined) return true;
  return built.children.every((row) =>
    actual.children.some(
      (candidate) =>
        row.table === candidate.table &&
        row.action === candidate.action &&
        spec.key.every((field) => {
          const wanted = comparedValue(row, field)[0];
          const held = comparedValue(candidate, field)[0];
          return sameValue(wanted, held) || (wanted === "NULL" && held === "");
        }) &&
        Object.keys(row.fields).every(
          (field) => !isComparedField(row.table, field) || candidate.fields[field] !== undefined,
        ),
    ),
  );
}

function sameIdentity(built: BuiltUnit, actual: BuiltUnit): boolean {
  const keyedDeletion =
    built.head.action === "DELETE" &&
    Object.keys(built.head.fields).some((field) => !field.startsWith("sys_"));
  if (built.head.action === "DELETE")
    return keyedDeletion || built.head.sysId === actual.head.sysId;
  return (
    keyedDeletion ||
    unitSpec(built.head.table).coalesce !== undefined ||
    built.head.sysId === actual.head.sysId
  );
}

// The captured authored graph must agree, even though the platform adds compiled snapshots.
// Empty-ID child records are the SDK's delete_multiple instructions: their table is still
// checked, so old rows left behind cannot silently survive in a captured flow.
export function capturedContentAgrees(
  built: BuiltUnit,
  actual: BuiltUnit,
  references: ReadonlyMap<string, string> = new Map(),
  nativeTriggers: readonly NativeTriggerContract[] = [],
): boolean {
  const expected = withNativeTriggerInputs(built, actual, nativeTriggers);
  if (expected === null) return false;
  const held = normalizeNativeDefaults(
    built,
    normalizeEmptySlaInputs(built, actual, nativeTriggers),
    nativeTriggers,
  );
  if (expected.head.table !== held.head.table) return false;
  if (expected.head.action !== held.head.action) return false;
  if (!sameIdentity(built, held)) return false;
  if (expected.head.action === "DELETE") return recordAgrees(expected.head, held.head, false);
  const compiled = !unitSpec(expected.head.table).comparable;
  if (!recordAgrees(expected.head, held.head, compiled)) return false;
  if (!compiled) {
    return (
      completeChildren(expected, held) &&
      compareUnit(expected, {
        head: instanceFields(held.head),
        children: held.children.map(instanceFields),
        version: "",
        foreignRows: 0,
      }).length === 0
    );
  }
  const authoredTables = new Set(expected.children.map((record) => record.table));
  const rows = authoredCaptureRows(expected, held);
  if (rows.some((record) => !authoredTables.has(record.table) && !SNAPSHOTS.has(record.table)))
    return false;
  return [...new Set(expected.children.map((record) => record.table))].every((table) => {
    const wanted = expected.children.filter(
      (record) => record.table === table && record.sysId !== "",
    );
    const held = rows.filter((record) => record.table === table);
    return (
      wanted.length === held.length &&
      wanted.every((record) => {
        const found = held.find((candidate) => candidate.sysId === record.sysId);
        return found !== undefined && recordAgrees(record, found, false, references);
      })
    );
  });
}

// Capture proves the authored graph; live head fields and the master snapshot must still
// agree. A stale capture cannot certify another published version on the instance.
export function compiledCopyAgrees(
  built: BuiltUnit,
  captured: BuiltUnit,
  copy: InstanceCopy | null,
): boolean {
  if (copy === null) return false;
  if (built.head.table === "sys_hub_flow" && copy.head["status"] !== "published") return false;
  if (built.head.table === "sys_hub_action_type_definition" && copy.head["state"] !== "published")
    return false;
  const snapshot = captured.head.fields["master_snapshot"];
  if (snapshot !== undefined && snapshot !== "" && copy.head["master_snapshot"] !== snapshot)
    return false;
  return recordAgrees(built.head, { ...built.head, fields: copy.head, referenceNames: {} }, true);
}

// A snapshot must belong to this definition, not merely appear somewhere in the payload.
function snapshotOwner(snapshot: UnitRecord, unit: BuiltUnit): boolean {
  const fields =
    unit.head.table === "sys_hub_flow"
      ? ["flow", "parent_flow"]
      : ["parent_action", "action_type", "action_type_definition"];
  const owners = fields.flatMap((field) =>
    snapshot.fields[field] ? [snapshot.fields[field]] : [],
  );
  return owners.length > 0 && owners.every((id) => id === unit.head.sysId);
}

export function publishedCapture(unit: BuiltUnit): boolean {
  if (unit.head.action === "DELETE") return true;
  const table = unit.head.table;
  if (table !== "sys_hub_flow" && table !== "sys_hub_action_type_definition") return true;
  if (table === "sys_hub_flow" && unit.head.fields["status"] !== "published") return false;
  if (table === "sys_hub_action_type_definition" && unit.head.fields["state"] !== "published")
    return false;
  const snapshotTable =
    table === "sys_hub_flow" ? "sys_hub_flow_snapshot" : "sys_hub_action_type_snapshot";
  const master = unit.head.fields["master_snapshot"] ?? "";
  return unit.children.some(
    (snapshot) =>
      snapshot.table === snapshotTable &&
      snapshot.sysId !== "" &&
      snapshot.action !== "DELETE" &&
      (master === "" || master === snapshot.sysId) &&
      (snapshot.fields["master"] === undefined || snapshot.fields["master"] === "true") &&
      snapshotOwner(snapshot, unit),
  );
}
