import { describe, expect, it } from "bun:test";
import { compareUnit, knownLoss } from "@snagentic/core";
import { copy, listCopy, record, revocationList, scriptInclude, unit } from "./units";

const INSTANCE_SCRIPT_INCLUDE = {
  sys_id: "123833b4d97d48be8e9ec5ea16f27764",
  sys_scope: "489da54ae67c4a3e9f1e1e4347e9119b",
  sys_mod_count: "1",
  active: "true",
  api_name: "x_2222332_s11.E2EUtil",
  caller_access: "",
  client_callable: "false",
  description: "Helpers for the E2E probe.",
  name: "E2EUtil",
};

describe("compareUnit (ADR-0033 item 2)", () => {
  it("finds nothing when the instance holds what the build would load", () => {
    const built = scriptInclude("Helpers for the E2E probe.");
    expect(compareUnit(built, copy(INSTANCE_SCRIPT_INCLUDE))).toEqual([]);
  });

  it("names each field the load would change, ignoring platform bookkeeping", () => {
    const built = scriptInclude("Helpers, edited in source.");
    expect(compareUnit(built, copy({ ...INSTANCE_SCRIPT_INCLUDE, sys_mod_count: "7" }))).toEqual([
      {
        kind: "field",
        table: "sys_script_include",
        row: "",
        field: "description",
        built: "Helpers, edited in source.",
        instance: "Helpers for the E2E probe.",
      },
    ]);
  });

  it("leaves fields the build omits unmanaged: a load does not touch them (S17)", () => {
    const built = scriptInclude("Helpers for the E2E probe.");
    const instance = copy({ ...INSTANCE_SCRIPT_INCLUDE, sandbox_callable: "true" });
    expect(compareUnit(built, instance)).toEqual([]);
  });

  it("treats line endings and trailing newlines as equal", () => {
    const built = scriptInclude("one\ntwo\n");
    expect(
      compareUnit(built, copy({ ...INSTANCE_SCRIPT_INCLUDE, description: "one\r\ntwo" })),
    ).toEqual([]);
  });

  it("reads the build's empty boolean as the instance's false", () => {
    const built = unit(
      "sys_dictionary_x_t_status",
      record("sys_dictionary", "d".repeat(32), { name: "x_t", element: "status", virtual: "" }),
    );
    expect(compareUnit(built, copy({ name: "x_t", element: "status", virtual: "false" }))).toEqual(
      [],
    );
  });

  it("compares a view by name: the build writes the default view as NULL", () => {
    expect(compareUnit(revocationList(["number"]), listCopy(["number"]))).toEqual([]);
  });

  it("compares a named view by name, whatever placeholder the build wrote", () => {
    const built = unit(
      "sys_ui_list_x_t_mobile",
      record(
        "sys_ui_list",
        "c".repeat(32),
        { name: "x_t", view: "e".repeat(32) },
        { view: "Mobile" },
      ),
    );
    const instance = copy({
      name: "x_t",
      view: "dd10f2738c1103100a22deb6dd2b4eee",
      "view.name": "Mobile",
    });
    expect(compareUnit(built, instance)).toEqual([]);
  });

  it("compares a list's columns as an ordered sequence, not by sys_id", () => {
    const built = revocationList(["number", "subject_user", "outcome"]);
    expect(compareUnit(built, listCopy(["number", "subject_user", "outcome"]))).toEqual([]);
    expect(compareUnit(built, listCopy(["subject_user", "number", "outcome"]))).toEqual([
      {
        kind: "rows",
        table: "sys_ui_list_element",
        built: ["number", "subject_user", "outcome"],
        instance: ["subject_user", "number", "outcome"],
      },
    ]);
  });

  it("matches choices by value and language, in any order, and compares their fields", () => {
    const choice = (sysId: string, value: string, label: string) =>
      record("sys_choice", sysId, { name: "x_t", element: "status", value, label, language: "en" });
    const built = unit(
      "sys_choice_x_t_status",
      record("sys_choice_set", "f".repeat(32), { name: "x_t", element: "status" }),
      [choice("1".repeat(32), "open", "Open"), choice("2".repeat(32), "closed", "Closed")],
    );
    const instance = copy({ name: "x_t", element: "status" }, [
      {
        sys_id: "9".repeat(32),
        name: "x_t",
        element: "status",
        value: "closed",
        label: "Done",
        language: "en",
      },
      {
        sys_id: "8".repeat(32),
        name: "x_t",
        element: "status",
        value: "open",
        label: "Open",
        language: "en",
      },
    ]);
    expect(compareUnit(built, instance)).toEqual([
      {
        kind: "field",
        table: "sys_choice",
        row: "closed|en",
        field: "label",
        built: "Closed",
        instance: "Done",
      },
    ]);
  });
});

describe("knownLoss (S16, S17)", () => {
  const field = (table: string, name: string, built: string, instance: string) =>
    ({ kind: "field", table, row: "", field: name, built, instance }) as const;

  it("names the SDK's API defaults", () => {
    expect(knownLoss(field("sys_script", "priority", "100", ""))).toBe("api-default");
    expect(
      knownLoss(
        field("sysevent_email_action", "digest_separator_html", "<p>&nbsp;</p>", "<br><hr><br>"),
      ),
    ).toBe("api-default");
  });

  it("names a reference written as its display value", () => {
    expect(
      knownLoss(field("sys_wizard_answer", "question", "Task", "dd21b6f78c5103100a22deb6dd2b4e61")),
    ).toBe("reference-display-value");
  });

  it("names a script the SDK only reformatted", () => {
    expect(
      knownLoss(
        field(
          "sys_ui_policy",
          "script_true",
          "function onCondition() {}",
          "function onCondition() {\n\n}",
        ),
      ),
    ).toBe("script-format");
  });

  it("names Form()'s column markers when the fields keep their order", () => {
    const rows = (built: string[], instance: string[]) =>
      ({ kind: "rows", table: "sys_ui_element", built, instance }) as const;
    expect(
      knownLoss(
        rows(
          [".begin_split|.begin_split", "number|", "state|", ".end_split|.end_split"],
          ["number|", "state|"],
        ),
      ),
    ).toBe("form-columns");
    expect(
      knownLoss(rows([".begin_split|.begin_split", "state|", "number|"], ["number|", "state|"])),
    ).toBeNull();
  });

  it("explains nothing else", () => {
    expect(knownLoss(field("sys_script_include", "description", "new", "old"))).toBeNull();
  });
});
