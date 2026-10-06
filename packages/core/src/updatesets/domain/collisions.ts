// Records captured in more than one open update set: whichever is committed last wins, so the
// other's change to that record is silently lost. Default update sets are the platform's
// catch-all for changes made without choosing a set; a change there means nobody holds the
// record, so they are counted apart instead of reported as collisions.

export interface OpenUpdateSet {
  readonly sysId: string;
  readonly name: string;
  readonly isDefault: boolean;
}

export interface CapturedUpdate {
  // The update name identifies the record across update sets (<table>_<sys_id>).
  readonly name: string;
  readonly updateSet: string;
  readonly type: string;
  readonly targetName: string;
  readonly action: string;
  readonly updatedBy: string;
  readonly updatedOn: string;
}

export interface Holder {
  readonly updateSet: string;
  readonly updateSetName: string;
  readonly updatedBy: string;
  readonly updatedOn: string;
  readonly action: string;
}

export interface Collision {
  readonly record: string;
  readonly type: string;
  readonly targetName: string;
  // Oldest first: the last one committed wins.
  readonly holders: readonly Holder[];
}

export interface CollisionReport {
  readonly collisions: readonly Collision[];
  readonly openRecords: number;
  readonly defaultSetRecords: number;
}

export function findCollisions(
  sets: readonly OpenUpdateSet[],
  updates: readonly CapturedUpdate[],
): CollisionReport {
  const byId = new Map(sets.map((set) => [set.sysId, set]));
  const held = new Map<string, CapturedUpdate[]>();
  const unmanaged = new Set<string>();
  for (const update of updates) {
    const set = byId.get(update.updateSet);
    if (set === undefined) {
      continue;
    }
    if (set.isDefault) {
      unmanaged.add(update.name);
      continue;
    }
    held.set(update.name, [...(held.get(update.name) ?? []), update]);
  }
  const collisions = [...held]
    .filter(([, list]) => new Set(list.map((update) => update.updateSet)).size > 1)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([record, list]) => collision(record, list, byId));
  return { collisions, openRecords: held.size, defaultSetRecords: unmanaged.size };
}

function collision(
  record: string,
  updates: readonly CapturedUpdate[],
  sets: ReadonlyMap<string, OpenUpdateSet>,
): Collision {
  const holders = [...updates]
    .sort((a, b) => (a.updatedOn < b.updatedOn ? -1 : a.updatedOn > b.updatedOn ? 1 : 0))
    .map((update) => ({
      updateSet: update.updateSet,
      updateSetName: sets.get(update.updateSet)?.name ?? "",
      updatedBy: update.updatedBy,
      updatedOn: update.updatedOn,
      action: update.action,
    }));
  const latest = updates[updates.length - 1];
  return { record, type: latest?.type ?? "", targetName: latest?.targetName ?? "", holders };
}
