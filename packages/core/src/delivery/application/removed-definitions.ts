import type { LedgerEntry } from "../../authoring/domain/ledger";
import type { BuiltUnit } from "../../authoring/domain/unit";
import type { SourceProject } from "../../authoring/ports";
import type { InstanceReader } from "../../connection/ports";
import { TableName } from "../../kernel/table-name";
import { deletionFor, type PlannedUnit, recordOf, type UnitProblem } from "../domain/unit-plan";

// Definitions the ledger holds that the build no longer makes, with no Now.del for them
// (ADR-0031 item 7): a configuration project never deletes, so a record still on the instance
// would silently stay, and the plan refuses. A record gone from the instance too (a plugin
// activation can remove one without a trace) is forgotten: push drops its ledger entry and loads
// nothing (ADR-0033 as amended, 2026-10-22). So is a record a plugin ships, which the source
// stopped restating: deleting it would remove the platform's own record, so the branch releases
// it and the instance keeps it as it is (ADR-0038 section 8, amended 2026-10-25).

type Held = "absent" | "shipped" | "own" | "unknown";

// Whether the instance holds the record, and whose it is: a plugin's package, or this project's
// (its scope, or global for a project in the global scope).
async function held(
  reader: InstanceReader,
  project: SourceProject,
  record: { table: string; sysId: string },
  signal: AbortSignal,
): Promise<Held> {
  const rows = await reader
    .query(
      {
        table: TableName.parse(record.table),
        query: `sys_id=${record.sysId}`,
        fields: ["sys_id", "sys_package"],
        limit: 1,
      },
      signal,
    )
    // An unreadable table proves nothing: the definition stays a problem.
    .catch(() => null);
  if (rows === null) return "unknown";
  const [row] = rows;
  if (row === undefined) return "absent";
  const sysPackage = row["sys_package"] ?? "";
  return sysPackage === "" || sysPackage === "global" || sysPackage === project.scopeId
    ? "own"
    : "shipped";
}

function refusal(project: SourceProject, name: string): UnitProblem {
  const line = deletionFor(name);
  const add = line === null ? "add a Now.del" : `add ${line}`;
  // A removed entry of a typed array (a UI action's role) is a unit of its own: the SDK
  // emits no deletion for it (spec 009 B2).
  return {
    project: project.path,
    updateName: name,
    kind: "removed",
    reason: `its definition was removed: ${add} to delete it on the instance, or restore it`,
  };
}

function forget(
  project: SourceProject,
  name: string,
  record: { table: string; sysId: string },
  entry: LedgerEntry,
): PlannedUnit {
  return {
    project: project.path,
    scope: project.scope,
    scopeId: project.scopeId,
    updateName: name,
    file: "",
    table: record.table,
    sysId: record.sysId,
    name,
    operation: "forget",
    changes: [],
    losses: [],
    alsoSets: [],
    digest: "",
    ledger: entry.instance,
    version: null,
    removes: null,
  };
}

export async function removedDefinitions(
  reader: InstanceReader,
  signal: AbortSignal,
  project: SourceProject,
  entries: ReadonlyMap<string, LedgerEntry>,
  units: readonly BuiltUnit[],
  deleting: ReadonlySet<string | null>,
): Promise<{ forgotten: PlannedUnit[]; problems: UnitProblem[] }> {
  const built = new Set(units.map((unit) => unit.updateName));
  const forgotten: PlannedUnit[] = [];
  const problems: UnitProblem[] = [];
  for (const [name, entry] of entries) {
    if (built.has(name) || deleting.has(name)) continue;
    const record = recordOf(name);
    const where = record === null ? "unknown" : await held(reader, project, record, signal);
    if (record !== null && (where === "absent" || where === "shipped")) {
      forgotten.push(forget(project, name, record, entry));
    } else problems.push(refusal(project, name));
  }
  return { forgotten, problems };
}
