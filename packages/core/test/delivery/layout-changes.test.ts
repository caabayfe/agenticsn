import { describe, expect, it } from "bun:test";
import {
  type LayoutFiles,
  type LayoutKind,
  layoutChange,
  layoutKindOf,
  parseRecord,
  recordHash,
} from "@snagentic/core";

const ID = "b0ce1c6d1d0a13878244c122d6a777b2";
const [A, B, C] = ["a".repeat(32), "b".repeat(32), "c".repeat(32)];
const DEFAULT = { sysId: "Default view", name: "" };
const PULLED_AT = "2026-10-13 18:51:36";

const CLASS: Record<LayoutKind, string> = {
  list: "sys_ui_list",
  section: "sys_ui_section",
  form: "sys_ui_form",
  related: "sys_ui_related_list",
};
const specOf = (kind: LayoutKind) => {
  const spec = layoutKindOf(CLASS[kind]);
  if (spec === undefined) throw new Error(kind);
  return spec;
};
const pathOf = (kind: LayoutKind) => `x_acme_app/${CLASS[kind]}/x-acme-app-task--${ID}.yaml`;

function record(
  kind: LayoutKind,
  fields: Record<string, string> = {},
  meta: Record<string, string> = {},
) {
  const all = { name: "x_acme_app_task", view: "Default view", sys_user: "", ...fields };
  return parseRecord(
    {
      _meta: {
        sys_class_name: CLASS[kind],
        sys_id: ID,
        scope: "x_acme_app",
        sys_domain: "global",
        sys_mod_count: "1",
        sys_updated_on: "2026-10-13 20:51:24",
        hash: recordHash(CLASS[kind], all),
        ...meta,
      },
      ...all,
    },
    [],
  );
}

const row = (kind: LayoutKind, sysId: string, fields: Record<string, string>) => ({
  sys_id: sysId,
  [specOf(kind).parentField]: ID,
  sys_mod_count: "0",
  sys_updated_on: PULLED_AT,
  ...fields,
});

const files = (kind: LayoutKind, rows: unknown[], fields = {}, meta = {}): LayoutFiles => ({
  record: record(kind, fields, meta),
  rows,
});
const change = (kind: LayoutKind, before: LayoutFiles | null, after: LayoutFiles | null) =>
  layoutChange(specOf(kind), pathOf(kind), before, after, DEFAULT);

const column = (sysId: string, element: string, position: string, extra = {}) =>
  row("list", sysId, { element, position, sum: "false", ...extra });
const LIST = files("list", [column(A, "number", "0"), column(B, "state", "1")]);

describe("layout changes (ADR-0029, ADR-0030)", () => {
  it("plans an edited list whole, rows in position order, with the versions it was pulled at", () => {
    const edited = files("list", [
      column(C, "priority", "2"),
      column(B, "state", "0"),
      column(A, "number", "1"),
    ]);
    const { layout, problems } = change("list", LIST, edited);
    expect(problems).toEqual([]);
    expect(layout).toMatchObject({
      kind: "list",
      operation: "update",
      path: pathOf("list"),
      scope: "x_acme_app",
      sysId: ID,
      table: "x_acme_app_task",
      view: DEFAULT,
      domain: "global",
      updateName: "sys_ui_list_x_acme_app_task_null",
      base: {
        record: "1|2026-10-13 20:51:24",
        rows: { [A]: `0|${PULLED_AT}`, [B]: `0|${PULLED_AT}` },
      },
    });
    expect(layout?.rows.map((r) => r["element"])).toEqual(["state", "number", "priority"]);
    expect(layout?.rows[0]).toEqual({
      sys_id: B,
      element: "state",
      position: "0",
      sum: "false",
      max_value: "",
      min_value: "",
      average_value: "",
    });
  });

  it("keeps the name the platform gave a pulled list", () => {
    const pulled = files(
      "list",
      LIST.rows as unknown[],
      {},
      { sys_update_name: "sys_ui_list_x_null" },
    );
    const { layout } = change("list", pulled, files("list", [column(A, "number", "0")]));
    expect(layout?.updateName).toBe("sys_ui_list_x_null");
  });

  it("removes a row by leaving it out: the layout is delivered whole", () => {
    const { layout, problems } = change("list", LIST, files("list", [column(A, "number", "0")]));
    expect(problems).toEqual([]);
    expect(layout?.rows.map((r) => r["element"])).toEqual(["number"]);
  });

  it("plans nothing when only provenance changed", () => {
    const touched = files(
      "list",
      [column(A, "number", "0", { sys_mod_count: "3" }), column(B, "state", "1")],
      {},
      { sys_mod_count: "2" },
    );
    expect(change("list", LIST, touched)).toEqual({ layout: null, problems: [] });
  });

  it("plans a form section with its fields, and names it after its sys_id", () => {
    const element = (sysId: string, name: string, position: string, type = "") =>
      row("section", sysId, { element: name, position, type, sys_ui_formatter: "" });
    const section = files(
      "section",
      [element(A, ".split", "1", ".split"), element(B, "number", "0")],
      { caption: "", header: "false", title: "true", roles: "" },
    );
    const { layout } = change("section", null, section);
    expect(layout).toMatchObject({
      kind: "section",
      operation: "create",
      updateName: `sys_ui_section_${ID}`,
      fields: {
        name: "x_acme_app_task",
        caption: "",
        view: "Default view",
        header: "false",
        title: "true",
        roles: "",
      },
      base: null,
    });
    expect(layout?.rows.map((r) => r["element"])).toEqual(["number", ".split"]);
  });

  it("refuses a form section change the platform would not record: its own fields alone", () => {
    const element = row("section", A, {
      element: "number",
      position: "0",
      type: "",
      sys_ui_formatter: "",
    });
    const pulled = files("section", [element], {
      caption: "",
      header: "false",
      title: "false",
      roles: "",
    });
    const headerOnly = files("section", [element], {
      caption: "",
      header: "true",
      title: "false",
      roles: "",
    });
    expect(change("section", pulled, headerOnly).problems.map((p) => p.reason)).toEqual([
      "the platform records a form section's header, title and roles only with a change to its rows: change a row in the same push, or set them on the instance",
    ]);
    const withRow = files("section", [{ ...element, position: "1" }], {
      caption: "",
      header: "true",
      title: "false",
      roles: "",
    });
    expect(change("section", pulled, withRow).problems).toEqual([]);
  });

  it("plans a form with its sections in order, and a related lists layout named after its view", () => {
    const form = change(
      "form",
      null,
      files("form", [
        row("form", A, { position: "1", sys_ui_section: C }),
        row("form", B, { position: "0", sys_ui_section: "d".repeat(32) }),
      ]),
    ).layout;
    expect(form?.updateName).toBe(`sys_ui_form_sections_${ID}`);
    expect(form?.rows.map((r) => r["sys_ui_section"])).toEqual(["d".repeat(32), C]);
    const related = change(
      "related",
      null,
      files("related", [row("related", A, { related_list: "task.parent", position: "0" })]),
    ).layout;
    expect(related?.updateName).toBe("sys_ui_related_x_acme_app_task_null");
  });

  it("plans a domain's own layout in its domain, and refuses moving it to another (ADR-0027)", () => {
    const DOMAIN = "9".repeat(32);
    const inDomain = files("list", LIST.rows as unknown[], {}, { sys_domain: DOMAIN });
    const created = change("list", null, inDomain).layout;
    expect(created?.domain).toBe(DOMAIN);
    expect(created?.updateName).toBe(`sys_ui_list_x_acme_app_task_null_${DOMAIN}`);
    expect(change("list", LIST, inDomain).problems).toEqual([
      {
        path: pathOf("list"),
        reason:
          "domain changed: a list layout's name, view and domain identify it; add a new file instead",
      },
    ]);
  });

  it("refuses what it cannot deliver whole, naming the way out", () => {
    const reasons = (kind: LayoutKind, after: LayoutFiles | null, before: LayoutFiles | null) =>
      change(kind, before, after).problems.map((p) => p.reason);
    expect(reasons("list", null, LIST)).toEqual([
      "deleting a list layout is not supported: restore the file, and remove its rows instead",
    ]);
    expect(reasons("list", files("list", [], { view: "d".repeat(32) }), LIST)).toEqual([
      "view changed: a list layout's name, view and domain identify it; add a new file instead",
    ]);
    expect(reasons("section", files("section", [], { sys_user: "u".repeat(32) }), null)).toEqual([
      "personal form layouts (sys_user set) are never pushed",
    ]);
    expect(reasons("list", files("list", [], { parent: "incident" }), null)).toEqual([
      "related list layouts (parent, relationship or element set) are not pushed yet: change them on the instance",
    ]);
    expect(
      reasons(
        "section",
        files("section", [], { caption: "Old" }),
        files("section", [], { caption: "New" }),
      ),
    ).toEqual([
      "caption changed: a form section's name, caption, view and domain identify it; add a new file instead",
    ]);
    expect(reasons("form", files("form", [], { sys_policy: "read" }), files("form", []))).toEqual([
      "sys_policy cannot be pushed; a form carries roles",
    ]);
    expect(
      reasons(
        "list",
        files("list", [
          column("bad", "number", "0"),
          column(B, "state", "1", { list_id: "e".repeat(32) }),
          column(C, "state", "2", { sum: "maybe" }),
          column(A, "number", "3", { group_by: "true" }),
        ]),
        LIST,
      ),
    ).toEqual([
      'a row has sys_id "bad": give each new row a new 32-character hex sys_id',
      `row ${B}: list_id must be ${ID}, the record whose file holds it`,
      `row ${C}: state is listed twice`,
      `row ${C}: sum must be true or false`,
      `row ${A}: group_by cannot be pushed; a list layout row carries element, position, sum, max_value, min_value and average_value`,
    ]);
    expect(reasons("list", { record: record("list"), rows: { not: "rows" } }, LIST)).toEqual([
      "the rows file must hold a list of rows",
    ]);
  });
});
