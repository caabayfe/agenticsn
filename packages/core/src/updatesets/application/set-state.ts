import type { Row } from "../../kernel/row";
import { listRows, SYS_UPDATE_SET, type UpdateSetDependencies } from "./update-set-reads";

const OPEN = "in progress";

// Writes one update set's state; the connection's writer satisfies it.
export interface UpdateSetStateWriter {
  update(
    table: string,
    sysId: string,
    values: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<unknown>;
}

export interface OpenUpdateSetRow {
  readonly sysId: string;
  readonly name: string;
  // The parent set's sys_id; empty for a top-level set.
  readonly parent: string;
}

// The update sets in progress, read live (ADR-0018), with their parents.
export async function openUpdateSets(
  deps: UpdateSetDependencies,
  signal: AbortSignal,
): Promise<OpenUpdateSetRow[]> {
  const fields = ["sys_id", "name", "parent"];
  const rows = await listRows(deps, SYS_UPDATE_SET, `state=${OPEN}`, fields, signal);
  return rows.map((row: Row) => ({
    sysId: row["sys_id"] ?? "",
    name: row["name"] ?? "",
    parent: row["parent"] ?? "",
  }));
}

// Sets update sets to complete on a development instance, the platform's own step before
// promotion: an accelerator upgrade completes the pack's earlier sets (ADR-0038, section 6).
// Completing a parent completes its scope children (spec 011, spike S-U).
export async function completeUpdateSets(
  writer: UpdateSetStateWriter,
  sysIds: readonly string[],
  signal: AbortSignal,
): Promise<void> {
  for (const sysId of sysIds) {
    signal.throwIfAborted();
    await writer.update(SYS_UPDATE_SET, sysId, { state: "complete" }, signal);
  }
}
