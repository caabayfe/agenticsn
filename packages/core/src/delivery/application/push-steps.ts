import type { InstanceReader } from "../../connection/ports";
import type { Row } from "../../kernel/row";
import { TableName } from "../../kernel/table-name";
import { artifactFromRow } from "../../metadata/domain/artifact";
import type { Catalog } from "../../metadata/domain/catalog";
import { DEFAULT_REDACTION } from "../../metadata/domain/redaction";
import type { PlannedWrite } from "../domain/change";
import { IntegrationUserNotFoundError, RecordChangedOnInstanceError } from "../domain/errors";
import type { InstanceWriter, PushJournal } from "../ports";

export interface InstanceSession {
  readonly reader: InstanceReader;
  readonly writer: InstanceWriter;
  readonly signal: AbortSignal;
}

const OPEN = "in progress";

async function first(
  session: InstanceSession,
  table: string,
  query: string,
  fields: readonly string[] | "all",
) {
  const rows = await session.reader.query(
    { table: TableName.parse(table), query, fields, limit: 1 },
    session.signal,
  );
  return rows[0] ?? null;
}

export async function userSysId(session: InstanceSession, username: string): Promise<string> {
  const user = await first(session, "sys_user", `user_name=${username}`, ["sys_id"]);
  if (user === null || (user["sys_id"] ?? "") === "") {
    throw new IntegrationUserNotFoundError(username);
  }
  return user["sys_id"] ?? "";
}

// The open update set for this name and scope, created when there is none (ADR-0007).
export async function openUpdateSet(session: InstanceSession, name: string, scopeId: string) {
  const query = `name=${name}^state=${OPEN}^application=${scopeId}`;
  const found = await first(session, "sys_update_set", query, ["sys_id"]);
  if (found !== null) {
    return { sysId: found["sys_id"] ?? "", name, created: false };
  }
  const created = await session.writer.insert(
    "sys_update_set",
    {
      name,
      application: scopeId,
      state: OPEN,
      description: "Changes pushed by snagentic from a reviewed plan (snagentic plan_push).",
    },
    session.signal,
  );
  return { sysId: created["sys_id"] ?? "", name, created: true };
}

// Makes `value` the user's current update set for the scope, returning what to restore.
export async function switchPreference(
  session: InstanceSession,
  user: string,
  name: string,
  value: string,
): Promise<NonNullable<PushJournal["preference"]>> {
  const existing = await first(session, "sys_user_preference", `user=${user}^name=${name}`, [
    "sys_id",
    "value",
  ]);
  if (existing !== null) {
    const sysId = existing["sys_id"] ?? "";
    await session.writer.update("sys_user_preference", sysId, { value }, session.signal);
    return { sysId, name, previousValue: existing["value"] ?? "" };
  }
  const created = await session.writer.insert(
    "sys_user_preference",
    { user, name, value },
    session.signal,
  );
  // A preference that did not exist is restored as empty: the platform then uses the default.
  return { sysId: created["sys_id"] ?? "", name, previousValue: "" };
}

export async function restorePreference(
  session: InstanceSession,
  preference: NonNullable<PushJournal["preference"]>,
): Promise<void> {
  await session.writer.update(
    "sys_user_preference",
    preference.sysId,
    { value: preference.previousValue },
    session.signal,
  );
}

// One record: refuse if the instance's copy moved on since the pull, then write.
export async function writeRecord(
  session: InstanceSession,
  catalog: Catalog,
  write: PlannedWrite,
  scopeId: string,
  written: number,
): Promise<void> {
  const current: Row | null = await first(session, write.table, `sys_id=${write.sysId}`, "all");
  if (write.operation === "create") {
    if (current !== null) {
      throw new RecordChangedOnInstanceError(write.path, written);
    }
    await session.writer.insert(
      write.table,
      { ...write.values, sys_id: write.sysId, sys_scope: scopeId },
      session.signal,
    );
    return;
  }
  const remoteHash =
    current === null ? null : artifactFromRow(current, catalog, DEFAULT_REDACTION).hash;
  if (remoteHash !== write.baseHash) {
    throw new RecordChangedOnInstanceError(write.path, written);
  }
  await session.writer.update(write.table, write.sysId, write.values, session.signal);
}

// The platform recorded the write in the target update set.
export async function captured(
  session: InstanceSession,
  write: PlannedWrite,
  updateSet: string,
): Promise<boolean> {
  const query = `name=${write.table}_${write.sysId}^update_set=${updateSet}`;
  return (await first(session, "sys_update_xml", query, ["sys_id"])) !== null;
}
