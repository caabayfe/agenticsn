import { describe, expect, it } from "bun:test";
import {
  ensureFactsOf,
  type FormFieldFact,
  formFieldId,
  formFieldStatus,
  placedElements,
  type SectionState,
  sectionSource,
} from "@snagentic/core";

// ADR-0042 form_field: a field a module puts on a shipped form, by table, view and section
// caption; the section restated whole as the instance holds it, with the field added.

const fact = (overrides: Partial<FormFieldFact> = {}): FormFieldFact => ({
  capability: "problem-rca",
  kind: "form_field",
  table: "problem_task",
  view: "Default view",
  section: "Analysis Information",
  field: "u_acc_rca_method",
  after: "cause_code",
  note: "the root cause method",
  ...overrides,
});

const element = (sysId: string, name: string, position: number, type = "", formatter = "") => ({
  sysId,
  element: name,
  type,
  formatter,
  position,
});

// Problem task's Analysis Information as pdi2 shipped it, in two columns (spike S-FF2).
const SECTION: SectionState = {
  sysId: "0c1fbc5c534823004247ddeeff7b125b",
  scope: { name: "global", sysId: "global" },
  table: "problem_task",
  view: "Default view",
  caption: "Analysis Information",
  title: "true",
  header: "false",
  elements: [
    element("e3", ".split", 3, ".split"),
    element("e1", "cause_code", 1),
    element("e0", "close_code", 0),
    element("e2", "cause_notes", 2),
    element("e4", "fix_notes", 4),
    element("e5", ".end_split", 5, ".end_split"),
    element("e6", "activity", 6, "formatter", "f".repeat(32)),
  ],
  onView: ["close_code", "cause_code", "cause_notes", "fix_notes", "number", "short_description"],
};

describe("reading form_field entries (ADR-0042)", () => {
  it("reads a field, defaulting the view to the default and the section to the first", () => {
    const problems: string[] = [];
    const facts = ensureFactsOf(
      "problem-rca",
      "modules/problem-rca/ensure.yaml",
      [
        { kind: "form_field", table: "problem_task", field: "u_acc_rca_method", note: "why" },
        {
          kind: "form_field",
          table: "sc_task",
          view: "sow",
          section: "Catalog task",
          field: "comments",
          after: "work_notes",
          note: "compose",
        },
        { kind: "form_field", table: "sc_task", note: "no field" },
      ],
      problems,
    );
    expect(facts).toEqual([
      fact({ view: "Default view", section: "", after: "", note: "why" }),
      fact({
        table: "sc_task",
        view: "sow",
        section: "Catalog task",
        field: "comments",
        after: "work_notes",
        note: "compose",
      }),
    ]);
    expect(problems).toEqual([
      "modules/problem-rca/ensure.yaml: entry 3 needs table, field and note (view, section and after are optional)",
    ]);
  });

  it("derives the module's element id from the pack, module, form, section and field", () => {
    expect(formFieldId("itsm", fact())).toMatch(/^[0-9a-f]{32}$/);
    expect(formFieldId("itsm", fact())).toBe(formFieldId("itsm", fact()));
    expect(formFieldId("itsm", fact({ section: "Notes" }))).not.toBe(formFieldId("itsm", fact()));
  });
});

describe("a form_field fact on the instance", () => {
  const own = formFieldId("itsm", fact());

  it("is missing until the field is on the form, ours once our element is, absent with no section", () => {
    expect(formFieldStatus(fact(), SECTION, own)).toBe("missing");
    const added = {
      ...SECTION,
      elements: [...SECTION.elements, element(own, "u_acc_rca_method", 7)],
    };
    expect(formFieldStatus(fact(), added, own)).toBe("ours");
    expect(formFieldStatus(fact({ field: "short_description" }), SECTION, own)).toBe("present");
    expect(formFieldStatus(fact(), { ...SECTION, sysId: null }, own)).toBe("absent");
  });

  it("goes after its element, keeping that column, and every other element keeps its place", () => {
    const { elements, added } = placedElements("itsm", SECTION, [fact()]);
    expect(added).toEqual(["u_acc_rca_method"]);
    expect(elements.map((e) => e.element)).toEqual([
      "close_code",
      "cause_code",
      "u_acc_rca_method",
      "cause_notes",
      ".split",
      "fix_notes",
      ".end_split",
      "activity",
    ]);
    expect(elements[2]?.sysId).toBe(own);
  });

  it("goes at the end of the section when its element is not there, or none is named (D3)", () => {
    for (const after of ["", "gone_field"]) {
      const { elements } = placedElements("itsm", SECTION, [fact({ after })]);
      expect(elements.at(-1)?.element).toBe("u_acc_rca_method");
    }
  });

  it("adds two modules' fields to one section, one after the other's, and none already there", () => {
    const second = fact({
      capability: "problem-fix",
      field: "u_acc_watch_until",
      after: "u_acc_rca_method",
    });
    const there = fact({ capability: "problem-fix", field: "number" });
    const { elements, added } = placedElements("itsm", SECTION, [fact(), second, there]);
    expect(added).toEqual(["u_acc_rca_method", "u_acc_watch_until"]);
    expect(elements.map((e) => e.element).slice(1, 4)).toEqual([
      "cause_code",
      "u_acc_rca_method",
      "u_acc_watch_until",
    ]);
  });

  it("restates a section that already holds ours exactly as it is", () => {
    const placed = placedElements("itsm", SECTION, [fact()]).elements;
    const held = {
      ...SECTION,
      elements: placed.map((e, position) => ({ ...e, position })),
    };
    expect(placedElements("itsm", held, [fact()])).toEqual({ elements: placed, added: [] });
  });
});

describe("the generated section", () => {
  it("restates the section by its keys and every element, a field without a type", () => {
    const { elements } = placedElements("itsm", SECTION, [fact()]);
    const text = sectionSource({ ...SECTION, sysId: "0c1fbc5c534823004247ddeeff7b125b" }, elements);
    const own = formFieldId("itsm", fact());
    expect(text.split("\n").slice(3, 9)).toEqual([
      "Record({",
      "    $id: '0c1fbc5c534823004247ddeeff7b125b',",
      "    table: 'sys_ui_section',",
      "    data: { name: 'problem_task', view: 'Default view', caption: 'Analysis Information', sys_domain: 'global', title: true, header: false },",
      "})",
      "",
    ]);
    expect(text).toContain(
      `    $id: '${own}',\n    table: 'sys_ui_element',\n    data: { sys_ui_section: '0c1fbc5c534823004247ddeeff7b125b', element: 'u_acc_rca_method', position: 2 },`,
    );
    expect(text).toContain(
      "data: { sys_ui_section: '0c1fbc5c534823004247ddeeff7b125b', element: '.split', type: '.split', position: 4 },",
    );
    expect(text).toContain(
      `data: { sys_ui_section: '0c1fbc5c534823004247ddeeff7b125b', element: 'activity', type: 'formatter', sys_ui_formatter: '${"f".repeat(32)}', position: 7 },`,
    );
    expect(text.match(/table: 'sys_ui_element'/g)).toHaveLength(8);
  });
});
