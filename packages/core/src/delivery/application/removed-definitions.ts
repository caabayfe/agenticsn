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
// nothing (ADR-0033 as amended, 2026-10-22).

async function present(
  reader: InstanceReader,
  record: { table: string; sysId: string },
  signal: AbortSignal,
): Promise<boolean> {
  const rows = await reader
    .query(
      {
        table: TableName.parse(record.table),
        query: `sys_id=${record.sysId}`,
        fields: ["sys_id"],
        limit: 1,
      },
      signal,
    )
    // An unreadable table proves nothing: the definition stays a problem.
    .catch(() => null);
  return rows === null || rows.length > 0;
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
    if (record !== null && !(await present(reader, record, signal))) {
      forgotten.push(forget(project, name, record, entry));
    } else problems.push(refusal(project, name));
  }
  return { forgotten, problems };
}
