import type { InstanceReader } from "../../connection/ports";
import type { Row } from "../../kernel/row";
import { SESSION_USER } from "../../kernel/session-user";
import { TableName } from "../../kernel/table-name";
import { artifactFromRow } from "../../metadata/domain/artifact";
import type { Catalog } from "../../metadata/domain/catalog";
import { DEFAULT_REDACTION } from "../../metadata/domain/redaction";
import { batchDescription, batchName, GLOBAL, updateSetName } from "../domain/batch";
import type { PlannedWrite } from "../domain/change";
import {
  IntegrationUserNotFoundError,
  RecordChangedOnInstanceError,
  UpdateSetScopeError,
} from "../domain/errors";
import type { InstanceWriter, SwitchedPreference } from "../ports";

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

// The signed-in user (ADR-0021), whose current update set the push sets; `username` names it
// in errors only.
export async function userSysId(session: InstanceSession, username: string): Promise<string> {
  const user = await first(session, "sys_user", `sys_id=${SESSION_USER}`, ["sys_id"]);
  if (user === null || (user["sys_id"] ?? "") === "") {
    throw new IntegrationUserNotFoundError(username);
  }
  return user["sys_id"] ?? "";
}

// The branch's batch (spec 004, D3): its open global update set, created when there is none,
// with the pull request's link added to its description.
export async function openBatch(session: InstanceSession, label: string, pr?: string) {
  const name = batchName(label);
  const query = `name=${name}^state=${OPEN}^application=${GLOBAL}`;
  const found = await first(session, "sys_update_set", query, ["sys_id", "description"]);
  if (found === null) {
    const values = {
      name,
      application: GLOBAL,
      state: OPEN,
      description: batchDescription(null, pr),
    };
    const created = await session.writer.insert("sys_update_set", values, session.signal);
    return { sysId: created["sys_id"] ?? "", name, created: true };
  }
  const sysId = found["sys_id"] ?? "";
  const existing = found["description"] ?? "";
  const description = batchDescription(existing, pr);
  if (description !== existing) {
    await session.writer.update("sys_update_set", sysId, { description }, session.signal);
  }
  return { sysId, name, created: false };
}

// The batch's open child for a scope other than global, created when there is none.
export async function openChild(
  session: InstanceSession,
  label: string,
  scope: { readonly name: string; readonly id: string },
  parent: string,
) {
  const name = updateSetName(label, scope.name);
  const query = `name=${name}^state=${OPEN}^application=${scope.id}`;
  const found = await first(session, "sys_update_set", query, ["sys_id"]);
  if (found !== null) {
    return { sysId: found["sys_id"] ?? "", name, created: false };
  }
  const created = await session.writer.insert(
    "sys_update_set",
    {
      name,
      application: scope.id,
      state: OPEN,
      parent,
      description: batchDescription(null),
    },
    session.signal,
  );
  const sysId = created["sys_id"] ?? "";
  // The platform creates an update set in the user's current application, whatever it is sent.
  if (created["application"] !== undefined && created["application"] !== scope.id) {
    const moved = await session.writer.update(
      "sys_update_set",
      sysId,
      { application: scope.id },
      session.signal,
    );
    if (moved["application"] !== scope.id) {
      throw new UpdateSetScopeError(name, scope.name);
    }
  }
  return { sysId, name, created: true };
}

// Makes `value` the user's current update set for the scope, returning what to restore.
export async function switchPreference(
  session: InstanceSession,
  user: string,
  name: string,
  value: string,
): Promise<SwitchedPreference> {
  const existing = await first(session, "sys_user_preference", `user=${user}^name=${name}`, [
    "sys_id",
    "value",
  ]);
  if (existing !== null) {
    const sysId = existing["sys_id"] ?? "";
    await session.writer.update("sys_user_preference", sysId, { value }, session.signal);
    return { sysId, user, name, previousValue: existing["value"] ?? "" };
  }
  const created = await session.writer.insert(
    "sys_user_preference",
    { user, name, value },
    session.signal,
  );
  // A preference that did not exist is restored as empty: the platform then uses the default.
  return { sysId: created["sys_id"] ?? "", user, name, previousValue: "" };
}

// Puts a preference back. The instance may replace the row while push runs: it is then found
// again by user and name; when it is gone, there is nothing left to restore.
export async function restorePreference(
  session: InstanceSession,
  preference: SwitchedPreference,
): Promise<void> {
  const value = { value: preference.previousValue };
  try {
    await session.writer.update("sys_user_preference", preference.sysId, value, session.signal);
  } catch (error) {
    const query = `user=${preference.user}^name=${preference.name}`;
    const row = await first(session, "sys_user_preference", query, ["sys_id"]);
    if (row === null) {
      return;
    }
    if (row["sys_id"] === preference.sysId) {
      throw error;
    }
    await session.writer.update("sys_user_preference", row["sys_id"] ?? "", value, session.signal);
  }
}

// One child row (ADR-0025): refuse if the row moved on since the pull, then write it.
async function writeRow(session: InstanceSession, write: PlannedWrite, written: number) {
  const fields = ["sys_id", "sys_mod_count", "sys_updated_on"];
  const current = await first(session, write.table, `sys_id=${write.sysId}`, fields);
  const version =
    current === null
      ? null
      : `${current["sys_mod_count"] ?? ""}|${current["sys_updated_on"] ?? ""}`;
  if (write.operation === "create" ? current !== null : version !== write.baseHash) {
    throw new RecordChangedOnInstanceError(write.path, written);
  }
  if (write.operation === "create") {
    await session.writer.insert(
      write.table,
      { ...write.values, sys_id: write.sysId },
      session.signal,
    );
  } else {
    await session.writer.update(write.table, write.sysId, write.values, session.signal);
  }
}

// One record: refuse if the instance's copy moved on since the pull, then write.
export async function writeRecord(
  session: InstanceSession,
  catalog: Catalog,
  write: PlannedWrite,
  scopeId: string,
  written: number,
): Promise<void> {
  if (write.owner !== null) {
    return writeRow(session, write, written);
  }
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

// The update set entry a write lands in: named by the platform, after the record itself or,
// for a child row, the record that owns it (a list is sys_ui_list_<table>_<view>).
async function updateNameOf(session: InstanceSession, write: PlannedWrite): Promise<string> {
  if (write.updateName !== null) {
    return write.updateName;
  }
  const { table, sysId } = write.owner ?? write;
  const row = await first(session, table, `sys_id=${sysId}`, ["sys_update_name"]);
  const name = row?.["sys_update_name"] ?? "";
  return name === "" ? `${table}_${sysId}` : name;
}

// The platform recorded the write in the target update set.
export async function captured(
  session: InstanceSession,
  write: PlannedWrite,
  updateSet: string,
): Promise<boolean> {
  const query = `name=${await updateNameOf(session, write)}^update_set=${updateSet}`;
  return (await first(session, "sys_update_xml", query, ["sys_id"])) !== null;
}
