import { HASH_EXCLUDED_FIELDS } from "../../kernel/record-hash";
import type { PlannedWrite } from "../domain/change";
import { nextModCount } from "../domain/load-stamp";
import { recordUpdateName } from "../domain/record-update";
import { recordingOf, type TableAttributes } from "../domain/recording";
import type { DeliveryWorkspace, TableDictionary } from "../ports";
import { parsed } from "./plan-records";

// Deep enough for any table hierarchy; a cycle in bad data stops here too.
const MAX_DEPTH = 12;

// The planned tables and every ancestor, read from the instance's dictionary.
async function tablesOf(
  dictionary: TableDictionary,
  names: readonly string[],
  signal: AbortSignal,
) {
  const known = new Map<string, TableAttributes>();
  let next = [...new Set(names)];
  for (let depth = 0; depth < MAX_DEPTH && next.length > 0; depth++) {
    for (const table of await dictionary.tables(next, signal)) known.set(table.name, table);
    next = [...new Set([...known.values()].map((t) => t.parent))].filter(
      (parent) => parent !== "" && !known.has(parent),
    );
  }
  return known;
}

// The whole record to load: its content fields as the working tree holds them, its domain when
// not global, never a field pull withholds (a secret) nor provenance; and its next sys_mod_count,
// so the instance stamps it as a write would (push adds the update time).
async function loadOf(workspace: DeliveryWorkspace, write: PlannedWrite) {
  const record = await parsed(workspace, write.path.replace(/\.yaml$/, ""), null);
  if (record === null) return null;
  const { fields, redacted, identity, meta } = record.artifact;
  const pulled = write.operation === "create" ? null : (meta["sys_mod_count"] ?? "");
  const content = Object.entries(fields).filter(
    ([name]) => !HASH_EXCLUDED_FIELDS.has(name) && !redacted.includes(name),
  );
  return {
    ...Object.fromEntries(content),
    ...(identity.domain === "global" ? {} : { sys_domain: identity.domain }),
    sys_mod_count: nextModCount(pulled),
  };
}

// Writes of a class the platform does not record when the Table API writes it (update_synch=false)
// are loaded as their update instead (ADR-0030); every other write keeps the Table API.
export async function routeWrites(
  deps: {
    readonly workspace: DeliveryWorkspace;
    readonly dictionary?: TableDictionary;
    readonly signal: AbortSignal;
  },
  writes: readonly PlannedWrite[],
): Promise<PlannedWrite[]> {
  const records = writes.filter((w) => w.owner === null);
  if (deps.dictionary === undefined || records.length === 0) return [...writes];
  const tables = await tablesOf(
    deps.dictionary,
    records.map((w) => w.table),
    deps.signal,
  );
  const routed: PlannedWrite[] = [];
  for (const write of writes) {
    const unrecorded = write.owner === null && recordingOf(write.table, tables) === "unrecorded";
    const load = unrecorded ? await loadOf(deps.workspace, write) : null;
    routed.push(load === null ? write : { ...write, load, updateName: recordUpdateName(write) });
  }
  return routed;
}
