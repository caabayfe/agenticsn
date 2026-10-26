import { describe, expect, it } from "bun:test";
import { type FormFieldFact, readSections } from "@snagentic/core";
import { fakeInstance } from "../support/fake-instance";

// ADR-0042 form_field: a fact's section is read live, by table, view and caption, in the global
// domain, with the fields of every section of that view.

const signal = new AbortController().signal;
const SOW = "f5c0a49877413010dc2c885d9f5a999e";
const fact = (overrides: Partial<FormFieldFact> = {}): FormFieldFact => ({
  capability: "request-portal",
  kind: "form_field",
  table: "sc_task",
  view: "sow",
  section: "Catalog task",
  field: "comments",
  after: "work_notes",
  note: "compose",
  ...overrides,
});

const section = (sysId: string, caption: string, extra: Record<string, string> = {}) => ({
  sys_id: sysId,
  name: "sc_task",
  view: SOW,
  caption,
  title: "false",
  header: "false",
  sys_domain: "global",
  sys_user: "",
  sys_scope: "ff5e8e53c3a53010965e070e9140ddb2",
  "sys_scope.scope": "sn_sow_req",
  ...extra,
});

const element = (sysId: string, sectionId: string, name: string, position: string, type = "") => ({
  sys_id: sysId,
  sys_ui_section: sectionId,
  element: name,
  type,
  sys_ui_formatter: "",
  position,
});

const instance = () =>
  fakeInstance({
    sys_ui_view: [{ sys_id: SOW, name: "sow" }],
    sys_ui_section: [
      section("s1", "Catalog task"),
      section("s2", "Notes"),
      section("s3", "Catalog task", { sys_domain: "acme" }),
      section("s4", "Catalog task", { sys_user: "u1" }),
    ],
    sys_ui_element: [
      element("e1", "s1", "number", "0"),
      element("e2", "s1", ".split", "1", ".split"),
      element("e3", "s1", "work_notes", "2"),
      element("e4", "s2", "description", "0"),
      element("e5", "s3", "comments", "0"),
      element("e6", "s4", "comments", "0"),
    ],
  });

describe("reading the sections the form_field facts name (ADR-0042)", () => {
  it("finds the global section by caption, its elements, its scope and the view's fields", async () => {
    const [state] = await readSections(instance().reader, [fact()], signal);
    expect(state).toEqual({
      sysId: "s1",
      scope: { name: "sn_sow_req", sysId: "ff5e8e53c3a53010965e070e9140ddb2" },
      table: "sc_task",
      view: "sow",
      caption: "Catalog task",
      title: "false",
      header: "false",
      elements: [
        { sysId: "e1", element: "number", type: "", formatter: "", position: 0 },
        { sysId: "e2", element: ".split", type: ".split", formatter: "", position: 1 },
        { sysId: "e3", element: "work_notes", type: "", formatter: "", position: 2 },
      ],
      onView: ["number", ".split", "work_notes", "description"],
    });
  });

  it("says when the view or the section is not on the instance", async () => {
    const states = await readSections(
      instance().reader,
      [fact({ view: "missing" }), fact({ section: "Gone" }), fact({ view: "Default view" })],
      signal,
    );
    expect(states.map((s) => [s.sysId, s.view, s.caption])).toEqual([
      [null, "missing", "Catalog task"],
      [null, "sow", "Gone"],
      [null, "Default view", "Catalog task"],
    ]);
  });
});
