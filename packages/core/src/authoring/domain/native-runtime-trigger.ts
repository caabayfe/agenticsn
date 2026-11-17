import type { BuiltUnit, UnitRecord } from "./unit";

function catalogFields(trigger: UnitRecord) {
  try {
    const inputs: unknown = JSON.parse(trigger.fields["trigger_inputs"] ?? "");
    if (!Array.isArray(inputs)) return null;
    const matches = inputs.filter(
      (value: unknown): value is Record<string, unknown> =>
        typeof value === "object" &&
        value !== null &&
        "name" in value &&
        value.name === "run_flow_in",
    );
    const mode = matches[0]?.["value"];
    if (
      matches.length !== 1 ||
      typeof mode !== "string" ||
      !["any", "background", "foreground"].includes(mode)
    )
      return null;
    return {
      active: "true",
      catalog_item: "",
      name: "",
      published_version: "",
      run_flow_in: mode,
      trigger_definition: "",
      sys_overrides: "",
    };
  } catch {
    return null;
  }
}

// The generated runtime row is bound to the published head; catalog execution mode comes
// from the reviewed authored trigger, never the capture being checked.
export function nativeRuntimeTrigger(actual: BuiltUnit, trigger: UnitRecord): UnitRecord | null {
  const catalog = trigger.fields["trigger_type"] === "service_catalog";
  const rows = actual.children.filter(
    (row) =>
      row.table === (catalog ? "sys_flow_catalog_trigger" : "sys_flow_trigger") &&
      row.sysId !== "" &&
      row.sysId === actual.head.fields["remote_trigger_id"],
  );
  const row = rows[0];
  const fields = catalog
    ? catalogFields(trigger)
    : { name: trigger.fields["trigger_type"] ?? "", active: "true" };
  if (rows.length !== 1 || row === undefined || fields === null) return null;
  return {
    ...row,
    action: "INSERT_OR_UPDATE",
    fields: { sys_id: row.sysId, ...fields },
    referenceNames: {},
  };
}
