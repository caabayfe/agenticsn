import type { InstanceReader } from "../../connection/ports";
import { SESSION_USER } from "../../kernel/session-user";
import { TableName } from "../../kernel/table-name";
import { batchDescription, batchName, GLOBAL, updateSetName } from "../domain/batch";
import { IntegrationUserNotFoundError, UpdateSetScopeError } from "../domain/errors";
import type { InstanceWriter, SwitchedPreference } from "../ports";

export interface InstanceSession {
  readonly reader: InstanceReader;
  readonly writer: InstanceWriter;
  readonly signal: AbortSignal;
}

const OPEN = "in progress";

// After Ctrl-C or an MCP cancel the run's signal is aborted, and the scheduler sends nothing
// with it: putting the user's preferences back would never reach the instance (REL2-02). The
// cleanup gets a signal of its own with a short deadline instead, and still goes through the
// scheduler.
export const RESTORE_DEADLINE_MS = 30_000;

export function restoring(session: InstanceSession): InstanceSession {
  return { ...session, signal: AbortSignal.timeout(RESTORE_DEADLINE_MS) };
}

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
  // The platform creates an update set in the user's current application, whatever it is
  // sent: push makes the scope's application current first, and checks.
  const stored = await first(session, "sys_update_set", `sys_id=${sysId}`, ["application"]);
  if (stored?.["application"] !== scope.id) {
    throw new UpdateSetScopeError(name, scope.name);
  }
  return { sysId, name, created: true };
}

// The user's preference `name` as it is now, the value to restore it to. One the user does
// not have is restored as empty: the platform then uses the default.
export async function currentPreference(
  session: InstanceSession,
  user: string,
  name: string,
): Promise<SwitchedPreference> {
  const existing = await first(session, "sys_user_preference", `user=${user}^name=${name}`, [
    "sys_id",
    "value",
  ]);
  return existing === null
    ? { sysId: "", user, name, previousValue: "" }
    : { sysId: existing["sys_id"] ?? "", user, name, previousValue: existing["value"] ?? "" };
}

// Sets the preference read as `current` to `value`: its row, or a new one when it had none.
export async function applyPreference(
  session: InstanceSession,
  current: SwitchedPreference,
  value: string,
): Promise<SwitchedPreference> {
  if (current.sysId !== "") {
    await session.writer.update("sys_user_preference", current.sysId, { value }, session.signal);
    return current;
  }
  const { user, name } = current;
  const created = await session.writer.insert(
    "sys_user_preference",
    { user, name, value },
    session.signal,
  );
  return { ...current, sysId: created["sys_id"] ?? "" };
}

// Puts a preference back. The instance may replace the row while push runs: it is then found
// again by user and name; when it is gone, there is nothing left to restore.
export async function restorePreference(
  session: InstanceSession,
  preference: SwitchedPreference,
): Promise<void> {
  const value = { value: preference.previousValue };
  const findAndRestore = async (error: unknown) => {
    const query = `user=${preference.user}^name=${preference.name}`;
    const row = await first(session, "sys_user_preference", query, ["sys_id"]);
    if (row === null) {
      return;
    }
    if (row["sys_id"] === preference.sysId) {
      throw error;
    }
    await session.writer.update("sys_user_preference", row["sys_id"] ?? "", value, session.signal);
  };
  // Journaled before its row was created: the row, if the switch made one, is found by name.
  if (preference.sysId === "") {
    await findAndRestore(null);
    return;
  }
  try {
    await session.writer.update("sys_user_preference", preference.sysId, value, session.signal);
  } catch (error) {
    await findAndRestore(error);
  }
}

// The platform recorded the load in the target update set under `updateName`. When it recorded
// it in the application's Default update set instead, as pdi2 did, and the update is this
// user's, it is moved into the target (spec 006, B5); an update someone else made is left where
// it is.
export async function captured(
  session: InstanceSession,
  updateName: string,
  target: { readonly updateSet: string; readonly username: string },
): Promise<boolean> {
  const fields = ["sys_id", "update_set"];
  const query = `name=${updateName}^update_set=${target.updateSet}`;
  if ((await first(session, "sys_update_xml", query, fields)) !== null) {
    return true;
  }
  const mine = `name=${updateName}^sys_updated_by=${target.username}`;
  const update = await first(session, "sys_update_xml", mine, fields);
  const set = await first(session, "sys_update_set", `sys_id=${update?.["update_set"] ?? ""}`, [
    "name",
  ]);
  if (update === null || set?.["name"] !== "Default") {
    return false;
  }
  const values = { update_set: target.updateSet };
  await session.writer.update("sys_update_xml", update["sys_id"] ?? "", values, session.signal);
  return true;
}
