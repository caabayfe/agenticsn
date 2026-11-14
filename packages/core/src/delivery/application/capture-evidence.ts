import type { BuiltUnit, InstanceCopy } from "../../authoring/domain/unit";
import { TableName } from "../../kernel/table-name";
import { capturedContentAgrees } from "../domain/capture-content";
import type { CaptureContent, CaptureDecoder } from "../ports";
import type { InstanceSession } from "./push-steps";

async function first(
  session: InstanceSession,
  table: string,
  query: string,
  fields: readonly string[],
) {
  const rows = await session.reader.query(
    { table: TableName.parse(table), query, fields, limit: 1 },
    session.signal,
  );
  return rows[0] ?? null;
}

function decoded(
  unit: BuiltUnit,
  payload: string,
  decode: CaptureDecoder,
  live: InstanceCopy | null,
): CaptureContent | null {
  const content = decode(unit.updateName, payload, live);
  return content?.published && capturedContentAgrees(unit, content.unit) ? content : null;
}

// Only matching content may count as captured or be moved from Default. Names and dates
// alone cannot distinguish the just-loaded definition from an older save in the same set.
export async function captureEvidence(
  session: InstanceSession,
  unit: BuiltUnit,
  target: {
    readonly updateSet: string;
    readonly username: string;
    readonly scopeId: string;
    readonly captureName: string;
  },
  decode: CaptureDecoder,
  live: InstanceCopy | null,
): Promise<CaptureContent | null> {
  const fields = ["sys_id", "update_set", "payload"];
  const found = await first(
    session,
    "sys_update_xml",
    `name=${target.captureName}^update_set=${target.updateSet}`,
    fields,
  );
  const held = decoded(unit, found?.["payload"] ?? "", decode, live);
  if (held !== null) return held;
  const set = await first(session, "sys_update_set", `name=Default^application=${target.scopeId}`, [
    "sys_id",
  ]);
  if (set === null) return null;
  const mine = await first(
    session,
    "sys_update_xml",
    `name=${target.captureName}^update_set=${set["sys_id"] ?? ""}^sys_updated_by=${target.username}`,
    fields,
  );
  const content = decoded(unit, mine?.["payload"] ?? "", decode, live);
  if (mine === null || content === null) return null;
  await session.writer.update(
    "sys_update_xml",
    mine["sys_id"] ?? "",
    { update_set: target.updateSet },
    session.signal,
  );
  const moved = await first(session, "sys_update_xml", `sys_id=${mine["sys_id"] ?? ""}`, fields);
  return moved?.["update_set"] === target.updateSet
    ? decoded(unit, moved["payload"] ?? "", decode, live)
    : null;
}
