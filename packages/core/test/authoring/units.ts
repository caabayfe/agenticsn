import type { BuiltUnit, Fields, InstanceCopy, UnitRecord } from "@snagentic/core";

// Built units and instance copies shaped as spikes S16 and S17 saw them on pdi2.

export const record = (
  table: string,
  sysId: string,
  fields: Fields,
  referenceNames: Fields = {},
): UnitRecord => ({ table, sysId, action: "INSERT_OR_UPDATE", fields, referenceNames });

export const unit = (
  updateName: string,
  head: UnitRecord,
  children: readonly UnitRecord[] = [],
): BuiltUnit => ({ updateName, file: `${updateName}.xml`, head, children });

export const copy = (
  head: Fields,
  children: readonly Fields[] = [],
  version = "1|2026-10-16 06:30:48",
): InstanceCopy => ({ head, children, version, foreignRows: 0 });

export const SCRIPT_INCLUDE_ID = "123833b4d97d48be8e9ec5ea16f27764";

export const scriptInclude = (description: string) =>
  unit(
    `sys_script_include_${SCRIPT_INCLUDE_ID}`,
    record("sys_script_include", SCRIPT_INCLUDE_ID, {
      sys_id: SCRIPT_INCLUDE_ID,
      sys_scope: "489da54ae67c4a3e9f1e1e4347e9119b",
      active: "true",
      api_name: "x_2222332_s11.E2EUtil",
      caller_access: "",
      client_callable: "false",
      description,
      name: "E2EUtil",
    }),
  );

export const LIST_ID = "0f321a262f274a04931f477f998e3940";

const column = (sysId: string, element: string, position: number) =>
  record("sys_ui_list_element", sysId, {
    sys_id: sysId,
    list_id: LIST_ID,
    element,
    position: String(position),
  });

export const revocationList = (elements: readonly string[]) =>
  unit(
    "sys_ui_list_x_2222332_acc_rev_revocation_null",
    record(
      "sys_ui_list",
      LIST_ID,
      {
        sys_id: LIST_ID,
        view: "Default view",
        name: "x_2222332_acc_rev_revocation",
        sys_domain: "global",
      },
      { view: "NULL" },
    ),
    elements.map((element, index) => column(`${index}`.padStart(32, "a"), element, index)),
  );

export const listCopy = (elements: readonly string[], version?: string) =>
  copy(
    {
      sys_id: LIST_ID,
      name: "x_2222332_acc_rev_revocation",
      view: "Default view",
      "view.name": "",
      sys_domain: "global",
    },
    elements.map((element, index) => ({
      sys_id: `${index}`.padStart(32, "b"),
      list_id: LIST_ID,
      element,
      position: String(index),
    })),
    version,
  );
