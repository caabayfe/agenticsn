import type { Row } from "../../kernel/row";
import { rawTimestamp } from "../../sync/application/pull-dependencies";
import { type CollisionReport, findCollisions } from "../domain/collisions";
import { UpdateSetNotFoundError } from "../domain/errors";
import {
  applications,
  listRows,
  rowsWhereIn,
  SET_FIELDS,
  SYS_UPDATE_SET,
  SYS_UPDATE_XML,
  type UpdateSetDependencies,
  updateCounts,
  validSysId,
} from "./update-set-reads";

const OPEN = "in progress";
const UPDATE_FIELDS = [
  "sys_id",
  "name",
  "update_set",
  "type",
  "target_name",
  "action",
  "table",
  "sys_updated_by",
  "sys_updated_on",
];

export interface UpdateSetSummary {
  readonly sysId: string;
  readonly name: string;
  readonly state: string;
  readonly application: string;
  readonly owner: string;
  readonly updates: number;
  readonly isDefault: boolean;
  readonly updatedOn: string;
}

export interface UpdateEntry {
  readonly sysId: string;
  readonly name: string;
  readonly type: string;
  readonly targetName: string;
  readonly action: string;
  readonly table: string;
  readonly updatedBy: string;
  readonly updatedOn: string;
}

async function summaries(
  deps: UpdateSetDependencies,
  sets: readonly Row[],
  signal: AbortSignal,
): Promise<UpdateSetSummary[]> {
  const ids = sets.map((set) => set["sys_id"] ?? "");
  const counts = await updateCounts(deps, ids, signal);
  const apps = await applications(
    deps,
    sets.map((set) => set["application"] ?? ""),
    signal,
  );
  return sets.map((set) => ({
    sysId: set["sys_id"] ?? "",
    name: set["name"] ?? "",
    state: set["state"] ?? "",
    application: apps.get(set["application"] ?? "")?.name ?? set["application"] ?? "",
    owner: set["sys_created_by"] ?? "",
    updates: counts.get(set["sys_id"] ?? "") ?? 0,
    isDefault: set["is_default"] === "true",
    updatedOn: set["sys_updated_on"] ?? "",
  }));
}

// Open update sets, and those changed in the last `days` days, most recently changed first.
export async function listUpdateSets(
  deps: UpdateSetDependencies,
  days: number,
  signal: AbortSignal,
): Promise<UpdateSetSummary[]> {
  const since = rawTimestamp(new Date(deps.now().getTime() - days * 86_400_000));
  const open = await listRows(deps, SYS_UPDATE_SET, `state=${OPEN}`, SET_FIELDS, signal);
  const recent = await listRows(
    deps,
    SYS_UPDATE_SET,
    `sys_updated_on>=${since}`,
    SET_FIELDS,
    signal,
  );
  const sets = [...new Map([...open, ...recent].map((set) => [set["sys_id"] ?? "", set])).values()];
  const result = await summaries(deps, sets, signal);
  return result.sort((a, b) =>
    a.updatedOn < b.updatedOn ? 1 : a.updatedOn > b.updatedOn ? -1 : 0,
  );
}

function entry(row: Row): UpdateEntry {
  return {
    sysId: row["sys_id"] ?? "",
    name: row["name"] ?? "",
    type: row["type"] ?? "",
    targetName: row["target_name"] ?? "",
    action: row["action"] ?? "",
    table: row["table"] ?? "",
    updatedBy: row["sys_updated_by"] ?? "",
    updatedOn: row["sys_updated_on"] ?? "",
  };
}

// One update set and its updates, without payloads.
export async function showUpdateSet(
  deps: UpdateSetDependencies,
  instance: string,
  sysId: string,
  signal: AbortSignal,
): Promise<{ updateSet: UpdateSetSummary; updates: UpdateEntry[] }> {
  const id = validSysId(sysId);
  const sets = await listRows(deps, SYS_UPDATE_SET, `sys_id=${id}`, SET_FIELDS, signal);
  const [updateSet] = await summaries(deps, sets, signal);
  if (updateSet === undefined) {
    throw new UpdateSetNotFoundError(instance, id);
  }
  const rows = await listRows(deps, SYS_UPDATE_XML, `update_set=${id}`, UPDATE_FIELDS, signal);
  const updates = rows.map(entry).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { updateSet, updates };
}

// Records captured in more than one open update set.
export async function updateSetCollisions(
  deps: UpdateSetDependencies,
  signal: AbortSignal,
): Promise<CollisionReport & { readonly openSets: number }> {
  const open = await listRows(deps, SYS_UPDATE_SET, `state=${OPEN}`, SET_FIELDS, signal);
  const sets = open.map((set) => ({
    sysId: set["sys_id"] ?? "",
    name: set["name"] ?? "",
    isDefault: set["is_default"] === "true",
  }));
  const ids = sets.map((set) => set.sysId);
  const rows = await rowsWhereIn(deps, SYS_UPDATE_XML, "update_set", ids, UPDATE_FIELDS, signal);
  const updates = rows.map((row) => ({ ...entry(row), updateSet: row["update_set"] ?? "" }));
  return { ...findCollisions(sets, updates), openSets: sets.length };
}
