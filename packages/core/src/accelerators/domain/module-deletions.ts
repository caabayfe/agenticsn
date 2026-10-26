// The records a module's source deletes (ADR-0031 item 7): each `Now.del('<table>', '<sys_id>')`
// in its Fluent files. A push deletes the record where the instance still holds it, so the
// install plan names them for the admin before the run. Pure: read from the files' text.

export interface PlannedDeletion {
  readonly table: string;
  readonly sysId: string;
}

// A Now.del by sys_id; a deletion by keys names no record the plan could list.
const NOW_DEL = /Now\.del\(\s*['"]([a-z0-9_]+)['"]\s*,\s*['"]([0-9a-f]{32})['"]\s*\)/g;

export function deletionsOf(text: string): PlannedDeletion[] {
  return [...text.matchAll(NOW_DEL)].flatMap(([, table, sysId]) =>
    table === undefined || sysId === undefined ? [] : [{ table, sysId }],
  );
}
