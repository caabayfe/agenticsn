import { HASH_EXCLUDED_FIELDS } from "../../kernel/record-hash";
import type { ParsedRecord, PlanProblem } from "./change";
import type { LayoutKindSpec } from "./layout-kinds";
import { layoutUpdateName } from "./layout-render";
import type { LayoutView } from "./layout-xml";
import type { PlannedLayout, Row } from "./planned-layout";

export type { PlannedLayout, Row, SectionRef } from "./planned-layout";

// A layout edit, planned as the whole layout (ADR-0029, ADR-0030): push loads the record with all
// its rows as one update the platform records, instead of writing rows it would not record. Pure.

export interface LayoutFiles {
  readonly record: ParsedRecord;
  // The rows file (<record>.children.<rows table>.yaml), parsed; null when absent.
  readonly rows: unknown;
}

const SYS_ID = /^[0-9a-f]{32}$/;

// Any change on the instance raises the modification count and the update time.
export const layoutVersion = (fields: Readonly<Record<string, string | undefined>>) =>
  `${fields["sys_mod_count"] ?? ""}|${fields["sys_updated_on"] ?? ""}`;

function rowsOf(document: unknown): Row[] | null {
  if (document === null) return [];
  if (!Array.isArray(document)) return null;
  return document.map((item: unknown) =>
    typeof item === "object" && item !== null && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).map(([key, value]) => [key, value === null ? "" : String(value)]),
        )
      : {},
  );
}

const content = (row: Row) =>
  JSON.stringify(
    Object.entries(row)
      .filter(([field]) => !HASH_EXCLUDED_FIELDS.has(field))
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );

const list = (names: readonly string[]) =>
  names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

function recordProblems(spec: LayoutKindSpec, before: LayoutFiles | null, after: LayoutFiles) {
  const now = after.record.artifact;
  const refused = spec.refused.find((r) => r.fields.some((f) => (now.fields[f] ?? "") !== ""));
  if (refused !== undefined) return [refused.reason];
  if (before === null) return [];
  const was = before.record.artifact;
  const changed = (f: string) => (was.fields[f] ?? "") !== (now.fields[f] ?? "");
  const identity = [
    ...spec.identity.filter(changed),
    ...(was.identity.domain === now.identity.domain ? [] : ["domain"]),
  ];
  const carried = new Set([...spec.identity, ...spec.recordFields]);
  const others = Object.keys({ ...was.fields, ...now.fields })
    .filter((f) => !carried.has(f) && !HASH_EXCLUDED_FIELDS.has(f) && changed(f))
    .sort();
  const names = list([...spec.identity, "domain"]);
  const createOnly = spec.fieldsOnCreateOnly === true ? spec.recordFields.filter(changed) : [];
  const them = createOnly.length === 1 ? "it" : "them";
  return [
    ...(createOnly.length === 0
      ? []
      : [
          `${list(createOnly)} of an existing ${spec.noun} cannot travel with the update set: the platform records its rows and the ${spec.noun} as it was; set ${them} on the instance, or leave ${them} as pulled`,
        ]),
    ...identity.map(
      (f) => `${f} changed: a ${spec.noun}'s ${names} identify it; add a new file instead`,
    ),
    ...others.map(
      (f) => `${f} cannot be pushed; a ${spec.noun} carries ${list(spec.recordFields)}`,
    ),
  ];
}

// One row's problems, `seen` holding the unique field's values met so far.
function problemsOfRow(spec: LayoutKindSpec, owner: string, row: Row, was: Row, seen: Set<string>) {
  const sysId = row["sys_id"] ?? "";
  if (!SYS_ID.test(sysId)) {
    return [`a row has sys_id "${sysId}": give each new row a new 32-character hex sys_id`];
  }
  const label = `row ${sysId}`;
  const problems: string[] = [];
  if ((row[spec.parentField] ?? "") !== owner) {
    problems.push(`${label}: ${spec.parentField} must be ${owner}, the record whose file holds it`);
  }
  const unique = spec.unique === null ? "" : (row[spec.unique] ?? "");
  if (unique !== "" && seen.has(unique)) problems.push(`${label}: ${unique} is listed twice`);
  seen.add(unique);
  for (const flag of spec.booleans.filter((f) => !["true", "false", ""].includes(row[f] ?? ""))) {
    problems.push(`${label}: ${flag} must be true or false`);
  }
  const carried = new Set([spec.parentField, ...spec.rowFields]);
  const uncarried = Object.keys(row).filter(
    (f) => !carried.has(f) && !HASH_EXCLUDED_FIELDS.has(f) && (row[f] ?? "") !== (was[f] ?? ""),
  );
  for (const field of uncarried.sort()) {
    problems.push(
      `${label}: ${field} cannot be pushed; a ${spec.noun} row carries ${list(spec.rowFields)}`,
    );
  }
  return problems;
}

function rowProblems(
  spec: LayoutKindSpec,
  owner: string,
  rows: readonly Row[],
  before: Map<string, Row>,
) {
  const seen = new Set<string>();
  return rows.flatMap((row) =>
    problemsOfRow(spec, owner, row, before.get(row["sys_id"] ?? "") ?? {}, seen),
  );
}

function unchanged(
  spec: LayoutKindSpec,
  before: LayoutFiles,
  after: LayoutFiles,
  was: readonly Row[],
  is: readonly Row[],
) {
  const record = (files: LayoutFiles) =>
    JSON.stringify([
      ...[...spec.identity, ...spec.recordFields].map((f) => files.record.artifact.fields[f] ?? ""),
      files.record.artifact.identity.domain,
    ]);
  const rows = (all: readonly Row[]) => all.map(content).sort().join("\n");
  return record(before) === record(after) && rows(was) === rows(is);
}

const byRowPosition = (a: Row, b: Row) => Number(a["position"] ?? "") - Number(b["position"] ?? "");

const carriedRow = (spec: LayoutKindSpec, row: Row): Row =>
  Object.fromEntries(["sys_id", ...spec.rowFields].map((f) => [f, row[f] ?? ""]));

function planned(
  spec: LayoutKindSpec,
  path: string,
  before: LayoutFiles | null,
  after: LayoutFiles,
  rows: readonly Row[],
  view: LayoutView,
): PlannedLayout {
  const { identity, fields } = after.record.artifact;
  const was = before === null ? null : rowsOf(before.rows);
  return {
    kind: spec.kind,
    operation: before === null ? "create" : "update",
    path,
    scope: identity.scope,
    sysId: identity.sysId,
    table: fields["name"] ?? "",
    view,
    domain: identity.domain,
    fields: Object.fromEntries(
      [...spec.identity, ...spec.recordFields].map((f) => [f, fields[f] ?? ""]),
    ),
    rows: rows.map((row) => carriedRow(spec, row)).sort(byRowPosition),
    updateName: "",
    sections: {},
    base:
      before === null
        ? null
        : {
            record: layoutVersion(before.record.artifact.meta),
            rows: Object.fromEntries(
              (was ?? []).map((row) => [row["sys_id"] ?? "", layoutVersion(row)]),
            ),
          },
  };
}

// What one layout's edit means for the instance. `view` names the layout's view (its sys_id and
// name), as the mirror holds it.
export function layoutChange(
  spec: LayoutKindSpec,
  path: string,
  before: LayoutFiles | null,
  after: LayoutFiles | null,
  view: LayoutView,
): { readonly layout: PlannedLayout | null; readonly problems: readonly PlanProblem[] } {
  const fail = (reasons: readonly string[]) => ({
    layout: null,
    problems: reasons.map((reason) => ({ path, reason })),
  });
  if (after === null) {
    return before === null
      ? fail([])
      : fail([
          `deleting a ${spec.noun} is not supported: restore the file, and remove its rows instead`,
        ]);
  }
  const [was, is] = [rowsOf(before?.rows ?? null), rowsOf(after.rows)];
  if (was === null || is === null) return fail(["the rows file must hold a list of rows"]);
  const owner = after.record.artifact.identity.sysId;
  const pulled = new Map(was.map((row) => [row["sys_id"] ?? "", row]));
  const problems = [
    ...recordProblems(spec, before, after),
    ...rowProblems(spec, owner, is, pulled),
  ];
  if (problems.length > 0) return fail(problems);
  if (before !== null && unchanged(spec, before, after, was, is)) return fail([]);
  const layout = planned(spec, path, before, after, is, view);
  const pulledName = before?.record.artifact.meta["sys_update_name"] ?? "";
  // A list keeps the name the platform gave it; every other kind's name follows from the record.
  const updateName =
    spec.kind === "list" && pulledName !== "" ? pulledName : layoutUpdateName(layout);
  return { layout: { ...layout, updateName }, problems: [] };
}
