import { describe, expect, it } from "bun:test";
import { type ListFiles, listChange, parseRecord, recordHash } from "@snagentic/core";

const LIST = "b0ce1c6d1d0a13878244c122d6a777b2";
const PATH = `x_acme_app/sys_ui_list/x-acme-app-task--${LIST}.yaml`;
const NUMBER = "a".repeat(32);
const STATE = "b".repeat(32);
const PRIORITY = "c".repeat(32);

function list(fields: Record<string, string> = {}, meta: Record<string, string> = {}) {
  const all = {
    name: "x_acme_app_task",
    view: "Default view",
    parent: "",
    relationship: "",
    element: "",
    sys_user: "",
    ...fields,
  };
  const document = {
    _meta: {
      sys_class_name: "sys_ui_list",
      sys_id: LIST,
      scope: "x_acme_app",
      sys_domain: "global",
      sys_mod_count: "1",
      sys_updated_on: "2026-10-13 20:51:24",
      sys_update_name: "sys_ui_list_x_acme_app_task_null",
      hash: recordHash("sys_ui_list", all),
      ...meta,
    },
    ...all,
  };
  return parseRecord(document, []);
}

const row = (sysId: string, element: string, position: string, extra = {}) => ({
  sys_id: sysId,
  list_id: LIST,
  element,
  position,
  sum: "false",
  max_value: "false",
  min_value: "false",
  average_value: "false",
  sys_mod_count: "0",
  sys_updated_on: "2026-10-13 18:51:36",
  ...extra,
});

const pulled: ListFiles = {
  record: list(),
  rows: [row(NUMBER, "number", "0"), row(STATE, "state", "1")],
};
const DEFAULT = { sysId: "Default view", name: "" };

describe("list layout changes (ADR-0029)", () => {
  it("plans an edited list as the whole list, with the versions it was pulled at", () => {
    const edited: ListFiles = {
      record: list(),
      rows: [row(STATE, "state", "0"), row(NUMBER, "number", "1"), row(PRIORITY, "priority", "2")],
    };
    const { list: planned, problems } = listChange(PATH, pulled, edited, DEFAULT);
    expect(problems).toEqual([]);
    expect(planned).toEqual({
      operation: "update",
      path: PATH,
      scope: "x_acme_app",
      updateName: "sys_ui_list_x_acme_app_task_null",
      layout: {
        sysId: LIST,
        table: "x_acme_app_task",
        view: DEFAULT,
        domain: "global",
        columns: [
          expect.objectContaining({ sysId: STATE, element: "state", position: "0" }),
          expect.objectContaining({ sysId: NUMBER, element: "number", position: "1" }),
          expect.objectContaining({ sysId: PRIORITY, element: "priority", position: "2" }),
        ],
      },
      base: {
        list: "1|2026-10-13 20:51:24",
        columns: { [NUMBER]: "0|2026-10-13 18:51:36", [STATE]: "0|2026-10-13 18:51:36" },
      },
    });
  });

  it("removes a column by leaving it out: the list is delivered whole", () => {
    const edited: ListFiles = { record: list(), rows: [row(NUMBER, "number", "0")] };
    const { list: planned, problems } = listChange(PATH, pulled, edited, DEFAULT);
    expect(problems).toEqual([]);
    expect(planned?.layout.columns.map((c) => c.element)).toEqual(["number"]);
  });

  it("plans nothing when only provenance changed", () => {
    const touched: ListFiles = {
      record: list({}, { sys_mod_count: "2" }),
      rows: [row(NUMBER, "number", "0", { sys_mod_count: "3" }), row(STATE, "state", "1")],
    };
    expect(listChange(PATH, pulled, touched, DEFAULT)).toEqual({ list: null, problems: [] });
  });

  it("plans a new list as a create, named as the platform will name it", () => {
    const { list: planned } = listChange(PATH, null, pulled, {
      sysId: "d".repeat(32),
      name: "Mobile",
    });
    expect(planned).toMatchObject({
      operation: "create",
      base: null,
      updateName: "sys_ui_list_x_acme_app_task_Mobile",
    });
  });

  it("plans a domain's own list in its domain, and refuses moving it to another (ADR-0027)", () => {
    const DOMAIN = "9".repeat(32);
    const inDomain: ListFiles = { record: list({}, { sys_domain: DOMAIN }), rows: pulled.rows };
    const created = listChange(PATH, null, inDomain, DEFAULT).list;
    expect(created?.layout.domain).toBe(DOMAIN);
    expect(created?.updateName).toBe(`sys_ui_list_x_acme_app_task_null_${DOMAIN}`);
    expect(listChange(PATH, pulled, inDomain, DEFAULT).problems).toEqual([
      {
        path: PATH,
        reason:
          "domain changed: a list's table, view and domain identify it; add a new list file instead",
      },
    ]);
  });

  it("refuses what it cannot deliver whole, naming the way out", () => {
    const reasons = (after: ListFiles | null, before: ListFiles | null = pulled) =>
      listChange(PATH, before, after, DEFAULT).problems.map((p) => p.reason);
    expect(reasons(null)).toEqual([
      "deleting a list layout is not supported: restore the file, and remove columns instead",
    ]);
    expect(reasons({ record: list({ view: "d".repeat(32) }), rows: pulled.rows })).toEqual([
      "view changed: a list's table, view and domain identify it; add a new list file instead",
    ]);
    expect(
      reasons({ record: list({ sys_user: "u".repeat(32) }), rows: pulled.rows }, null),
    ).toEqual(["personal list layouts (sys_user set) are never pushed"]);
    expect(reasons({ record: list({ parent: "incident" }), rows: pulled.rows }, null)).toEqual([
      "related list layouts (parent, relationship or element set) are not pushed yet: change them on the instance",
    ]);
    expect(
      reasons({
        record: list(),
        rows: [
          row("bad", "number", "0"),
          row(STATE, "state", "1", { list_id: "e".repeat(32) }),
          row(PRIORITY, "state", "2", { sum: "maybe" }),
        ],
      }),
    ).toEqual([
      'a column has sys_id "bad": give each new column a new 32-character hex sys_id',
      `column ${STATE}: list_id must be ${LIST}, the list whose file holds it`,
      `column ${PRIORITY}: state is listed twice`,
      `column ${PRIORITY}: sum must be true or false`,
    ]);
    expect(reasons({ record: list(), rows: { not: "a list" } })).toEqual([
      "the columns file must hold a list of rows",
    ]);
  });

  it("refuses a column field the list layout cannot carry", () => {
    const edited: ListFiles = {
      record: list(),
      rows: [row(NUMBER, "number", "0", { group_by: "true" }), row(STATE, "state", "1")],
    };
    expect(listChange(PATH, pulled, edited, DEFAULT).problems).toEqual([
      {
        path: PATH,
        reason: `column ${NUMBER}: group_by cannot be pushed; a list layout carries element, position, sum, max_value, min_value and average_value`,
      },
    ]);
  });
});
