import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Row } from "../../kernel/row";
import type { UnloadField, UnloadRecord } from "./unload-xml";

// What "Export to XML" does (UpdateSetExport): copy the update set into a remote update set
// in state "loaded", copy each of its updates pointing at that copy, and unload both.

export interface FieldSpec {
  readonly name: string;
  readonly reference: boolean;
}

export interface Application {
  readonly sysId: string;
  readonly name: string;
  readonly scope: string;
  readonly version: string;
}

export interface ExportStamp {
  // Raw UTC time and user of the export, as the copies' creation stamp.
  readonly at: string;
  readonly by: string;
}

// The copies' sys_ids are derived from the originals, so exporting again gives the same file
// and importing it twice updates rather than duplicates.
export function exportId(sourceSysId: string): string {
  return bytesToHex(sha256(utf8ToBytes(`snagentic-export/${sourceSysId}`))).slice(0, 32);
}

function fields(spec: readonly FieldSpec[], values: Row, displays: Row): UnloadField[] {
  return spec.map((field) => {
    const value = values[field.name] ?? "";
    return field.reference
      ? { name: field.name, value, display: displays[field.name] ?? "" }
      : { name: field.name, value };
  });
}

const created = (stamp: ExportStamp): Row => ({
  sys_created_by: stamp.by,
  sys_created_on: stamp.at,
  sys_updated_by: stamp.by,
  sys_updated_on: stamp.at,
  sys_mod_count: "0",
});

export function remoteUpdateSet(
  spec: readonly FieldSpec[],
  updateSet: Row,
  application: Application,
  stamp: ExportStamp,
): UnloadRecord {
  const values: Row = {
    ...created(stamp),
    application: application.sysId,
    application_name: application.name,
    application_scope: application.scope,
    application_version: application.version,
    description: updateSet["description"] ?? "",
    name: updateSet["name"] ?? "",
    origin_sys_id: updateSet["origin_sys_id"] ?? "",
    release_date: updateSet["release_date"] ?? "",
    remote_sys_id: updateSet["sys_id"] ?? "",
    state: "loaded",
    sys_class_name: "sys_remote_update_set",
    sys_id: exportId(updateSet["sys_id"] ?? ""),
  };
  const displays: Row = { application: application.name };
  return {
    table: "sys_remote_update_set",
    action: "INSERT_OR_UPDATE",
    fields: fields(spec, values, displays),
  };
}

export function exportedUpdate(
  spec: readonly FieldSpec[],
  update: Row,
  application: Application | undefined,
  updateSet: Row,
  stamp: ExportStamp,
): UnloadRecord {
  const values: Row = {
    ...update,
    ...created(stamp),
    remote_update_set: exportId(updateSet["sys_id"] ?? ""),
    sys_id: exportId(update["sys_id"] ?? ""),
    update_set: "",
  };
  const displays: Row = {
    application: application?.name ?? "",
    remote_update_set: updateSet["name"] ?? "",
  };
  return {
    table: "sys_update_xml",
    action: "INSERT_OR_UPDATE",
    fields: fields(spec, values, displays),
  };
}

// Updates in the order they were recorded, which is the order they are applied.
export function inRecordedOrder(updates: readonly Row[]): Row[] {
  const key = (row: Row) => `${row["sys_recorded_at"] ?? ""}|${row["sys_id"] ?? ""}`;
  return [...updates].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}
