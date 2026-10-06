import type { Row } from "../../kernel/row";
import {
  listRows,
  rowsWhereIn,
  SET_FIELDS,
  SYS_UPDATE_SET,
  SYS_UPDATE_XML,
  type UpdateSetDependencies,
} from "./update-set-reads";

const OPEN = "in progress";

export interface RecordHolder {
  readonly updateSet: string;
  readonly updateSetName: string;
  readonly updatedBy: string;
}

// Which open update sets already hold these records (by update name, <table>_<sys_id>):
// someone else's work in progress on the same record.
export async function heldInOpenUpdateSets(
  deps: UpdateSetDependencies,
  updateNames: readonly string[],
  signal: AbortSignal,
): Promise<Map<string, RecordHolder[]>> {
  const held = new Map<string, RecordHolder[]>();
  if (updateNames.length === 0) {
    return held;
  }
  const open = await listRows(deps, SYS_UPDATE_SET, `state=${OPEN}`, SET_FIELDS, signal);
  const names = new Map(open.map((set: Row) => [set["sys_id"] ?? "", set["name"] ?? ""]));
  const fields = ["sys_id", "name", "update_set", "sys_updated_by"];
  const rows = await rowsWhereIn(deps, SYS_UPDATE_XML, "name", updateNames, fields, signal);
  for (const row of rows) {
    const setName = names.get(row["update_set"] ?? "");
    if (setName === undefined) {
      continue;
    }
    const name = row["name"] ?? "";
    held.set(name, [
      ...(held.get(name) ?? []),
      {
        updateSet: row["update_set"] ?? "",
        updateSetName: setName,
        updatedBy: row["sys_updated_by"] ?? "",
      },
    ]);
  }
  return held;
}
