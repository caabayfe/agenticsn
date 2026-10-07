import { TableName } from "../../kernel/table-name";
import { rawTimestamp } from "../../sync/application/pull-dependencies";
import { UpdateSetNotFoundError } from "../domain/errors";
import {
  type Application,
  exportedUpdate,
  type FieldSpec,
  inRecordedOrder,
  remoteUpdateSet,
} from "../domain/export-mapping";
import { renderUnload } from "../domain/unload-xml";
import { withheldReason } from "../domain/withheld";
import {
  applications,
  listRows,
  SYS_UPDATE_SET,
  SYS_UPDATE_XML,
  type UpdateSetDependencies,
  validSysId,
} from "./update-set-reads";

const SYS_DICTIONARY = TableName.parse("sys_dictionary");

export interface ExportedUpdateSet {
  readonly sysId: string;
  readonly name: string;
  readonly updates: number;
  readonly xml: string;
  // Updates left out because their payload holds a secret; move these by hand.
  readonly withheld: readonly WithheldUpdate[];
}

export interface WithheldUpdate {
  readonly name: string;
  readonly target: string;
  readonly reason: string;
}

// The fields a record of `table` has on this instance, so the export follows its release.
async function fieldSpecs(
  deps: UpdateSetDependencies,
  table: string,
  signal: AbortSignal,
): Promise<FieldSpec[]> {
  const fields = ["sys_id", "element", "internal_type"];
  const rows = await listRows(
    deps,
    SYS_DICTIONARY,
    `name=${table}^elementISNOTEMPTY`,
    fields,
    signal,
  );
  return rows.map((row) => ({
    name: row["element"] ?? "",
    reference: row["internal_type"] === "reference",
  }));
}

// The update set as ServiceNow's "Export to XML" writes it, built from reads only, so it
// works on any instance and leaves no temporary remote update set behind.
export async function exportUpdateSet(
  deps: UpdateSetDependencies,
  instance: string,
  sysId: string,
  exportedBy: string,
  signal: AbortSignal,
): Promise<ExportedUpdateSet> {
  const id = validSysId(sysId);
  const [set] = await listRows(deps, SYS_UPDATE_SET, `sys_id=${id}`, "all", signal);
  if (set === undefined) {
    throw new UpdateSetNotFoundError(instance, id);
  }
  const remoteSpec = await fieldSpecs(deps, "sys_remote_update_set", signal);
  const updateSpec = await fieldSpecs(deps, "sys_update_xml", signal);
  const all = inRecordedOrder(
    await listRows(deps, SYS_UPDATE_XML, `update_set=${id}`, "all", signal),
  );
  const withheld = all.flatMap((update) => {
    const reason = withheldReason(update["payload"] ?? "");
    return reason === null
      ? []
      : [{ name: update["name"] ?? "", target: update["target_name"] ?? "", reason }];
  });
  const updates = all.filter((update) => withheldReason(update["payload"] ?? "") === null);
  const appIds = [
    set["application"] ?? "",
    ...updates.map((update) => update["application"] ?? ""),
  ];
  const apps = await applications(deps, appIds, signal);
  const appOf = (appId: string): Application =>
    apps.get(appId) ?? { sysId: appId, name: "", scope: "", version: "" };
  const stamp = { at: rawTimestamp(deps.now()), by: exportedBy };
  const records = [
    remoteUpdateSet(remoteSpec, set, appOf(set["application"] ?? ""), stamp),
    ...updates.map((update) =>
      exportedUpdate(updateSpec, update, appOf(update["application"] ?? ""), set, stamp),
    ),
  ];
  return {
    sysId: id,
    name: set["name"] ?? "",
    updates: updates.length,
    xml: renderUnload(stamp.at, records),
    withheld,
  };
}
