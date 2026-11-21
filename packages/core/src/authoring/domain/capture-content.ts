import { instanceFields, recordAgrees, recordDifferences, rowLabel } from "./capture-record";
import { compareUnit, isComparedField } from "./compare";
import { authoredCaptureRows } from "./compiled-graph";
import { normalizeEmptySlaInputs } from "./empty-sla-input";
import { normalizeNativeDefaults } from "./native-input-defaults";
import { type NativeTriggerContract, withNativeTriggerInputs } from "./native-trigger-capture";
import type { BuiltUnit, Fields, InstanceCopy, UnitRecord } from "./unit";
import { unitSpec } from "./unit-specs";
import { comparedValue, sameValue } from "./values";

const SNAPSHOTS = new Set(["sys_hub_flow_snapshot", "sys_hub_action_type_snapshot"]);

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

// A comparable unit's captured rows against the built ones.
function comparableDifferences(expected: BuiltUnit, held: BuiltUnit): string[] {
  if (!completeChildren(expected, held)) return ["rows or fields of the build are absent"];
  return compareUnit(expected, {
    head: instanceFields(held.head),
    children: held.children.map(instanceFields),
    version: "",
    foreignRows: 0,
  }).map((d) =>
    d.kind === "field"
      ? `${d.table}${d.row === "" ? "" : ` [${d.row}]`}.${d.field}`
      : `${d.table} rows`,
  );
}

// A compiled unit's captured authored graph, table by table. Empty-ID child records are the
// SDK's delete_multiple instructions: their table is still checked, so old rows left behind
// cannot silently survive in a captured flow.
function graphDifferences(
  expected: BuiltUnit,
  held: BuiltUnit,
  references: ReadonlyMap<string, string>,
): string[] {
  const authoredTables = [...new Set(expected.children.map((record) => record.table))];
  const rows = authoredCaptureRows(expected, held);
  const unexpected = new Set(
    rows
      .filter((record) => !authoredTables.includes(record.table) && !SNAPSHOTS.has(record.table))
      .map((record) => `${record.table} rows (not in the build)`),
  );
  if (unexpected.size > 0) return [...unexpected];
  return authoredTables.flatMap((table) => {
    const wanted = expected.children.filter(
      (record) => record.table === table && record.sysId !== "",
    );
    const captured = rows.filter((record) => record.table === table);
    const counts =
      wanted.length === captured.length
        ? []
        : [`${table} rows (built ${wanted.length}, captured ${captured.length})`];
    return [
      ...counts,
      ...wanted.flatMap((record) => {
        const found = captured.find((candidate) => candidate.sysId === record.sysId);
        return found === undefined
          ? [`${rowLabel(record, false)} (absent)`]
          : recordDifferences(record, found, false, references);
      }),
    ];
  });
}

// Where a decoded capture disagrees with the reviewed build, as names (tables, rows, fields),
// never values. Empty when the captured authored graph agrees, even though the platform adds
// compiled snapshots.
export function capturedContentDifferences(
  built: BuiltUnit,
  actual: BuiltUnit,
  references: ReadonlyMap<string, string> = new Map(),
  nativeTriggers: readonly NativeTriggerContract[] = [],
  logicInputs: readonly Fields[] = [],
): string[] {
  const expected = withNativeTriggerInputs(built, actual, nativeTriggers);
  if (expected === null) return ["its trigger could not be checked against a native definition"];
  const held = normalizeNativeDefaults(
    built,
    normalizeEmptySlaInputs(built, actual, nativeTriggers),
    [...nativeTriggers, { logicInputs }],
  );
  if (expected.head.table !== held.head.table || expected.head.action !== held.head.action)
    return [`${expected.head.table}: held as ${held.head.action} of ${held.head.table}`];
  if (!sameIdentity(built, held)) return [`${expected.head.table}: another record's capture`];
  if (expected.head.action === "DELETE") return recordDifferences(expected.head, held.head, false);
  const compiled = !unitSpec(expected.head.table).comparable;
  const head = recordDifferences(expected.head, held.head, compiled);
  if (head.length > 0) return head;
  return compiled
    ? graphDifferences(expected, held, references)
    : comparableDifferences(expected, held);
}

export const capturedContentAgrees = (
  built: BuiltUnit,
  actual: BuiltUnit,
  references: ReadonlyMap<string, string> = new Map(),
  nativeTriggers: readonly NativeTriggerContract[] = [],
  logicInputs: readonly Fields[] = [],
): boolean =>
  capturedContentDifferences(built, actual, references, nativeTriggers, logicInputs).length === 0;

// A raw inactive draft has no publication-generated rows. This proves only the authored
// pre-publication graph for a reviewed reload; it cannot certify published delivery.
export function draftContentAgrees(
  built: BuiltUnit,
  actual: BuiltUnit,
  references: ReadonlyMap<string, string> = new Map(),
): boolean {
  if (built.head.table !== "sys_hub_flow" || actual.head.table !== built.head.table) return false;
  if (actual.head.fields["status"] !== "draft" || actual.head.fields["active"] !== "false")
    return false;
  if (actual.head.fields["master_snapshot"] || actual.head.fields["latest_snapshot"]) return false;
  if (!sameIdentity(built, actual) || !recordAgrees(built.head, actual.head, true)) return false;
  const wanted = built.children.filter((row) => row.sysId !== "");
  const held = actual.children.filter((row) => row.sysId !== "");
  return (
    wanted.length === held.length &&
    wanted.every((row) => {
      const matches = held.filter(
        (candidate) => candidate.table === row.table && candidate.sysId === row.sysId,
      );
      const found = matches[0];
      return (
        matches.length === 1 && found !== undefined && recordAgrees(row, found, false, references)
      );
    })
  );
}

// Where the live definition disagrees with the reviewed build and its capture. Capture proves
// the authored graph; live head fields and the master snapshot must still agree. A stale
// capture cannot certify another published version on the instance.
export function compiledCopyDifferences(
  built: BuiltUnit,
  captured: BuiltUnit,
  copy: InstanceCopy | null,
): string[] {
  const table = built.head.table;
  if (copy === null) return [`${table}: not on the instance`];
  if (table === "sys_hub_flow" && copy.head["status"] !== "published")
    return [`${table}.status (not published)`];
  if (table === "sys_hub_action_type_definition" && copy.head["state"] !== "published")
    return [`${table}.state (not published)`];
  const snapshot = captured.head.fields["master_snapshot"];
  if (snapshot !== undefined && snapshot !== "" && copy.head["master_snapshot"] !== snapshot)
    return [`${table}.master_snapshot (not the captured snapshot)`];
  return recordDifferences(
    built.head,
    { ...built.head, fields: copy.head, referenceNames: {} },
    true,
  );
}

export const compiledCopyAgrees = (
  built: BuiltUnit,
  captured: BuiltUnit,
  copy: InstanceCopy | null,
): boolean => compiledCopyDifferences(built, captured, copy).length === 0;

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
