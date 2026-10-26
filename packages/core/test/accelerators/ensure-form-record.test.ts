import { describe, expect, it } from "bun:test";
import {
  droppedElements,
  type FormFieldFact,
  type FormSectionRecord,
  formFieldId,
  formRecordOf,
  formRecordText,
  placedElements,
  type SectionState,
} from "@snagentic/core";

// form_field removal: the install records the sections each module added to, and a fact the
// module dropped takes only its own element off (form-field-plan.md, section 4 item 6).

const RECORD: FormSectionRecord = {
  module: "problem-rca",
  sysId: "0c1fbc5c534823004247ddeeff7b125b",
  table: "problem_task",
  view: "Default view",
  caption: "Analysis Information",
};

const fact = (field: string, capability = "problem-rca"): FormFieldFact => ({
  capability,
  kind: "form_field",
  table: "problem_task",
  view: "Default view",
  section: "Analysis Information",
  field,
  after: "",
  note: "why",
});

const element = (sysId: string, name: string, position: number) => ({
  sysId,
  element: name,
  type: "",
  formatter: "",
  position,
});

const own = (field: string, capability = "problem-rca") =>
  formFieldId("itsm", fact(field, capability));

const STATE: SectionState = {
  sysId: RECORD.sysId,
  scope: { name: "global", sysId: "global" },
  table: "problem_task",
  view: "Default view",
  caption: "Analysis Information",
  title: "true",
  header: "false",
  elements: [
    element("e0", "cause_code", 0),
    element(own("u_acc_rca_method"), "u_acc_rca_method", 1),
    element(own("u_acc_watch_until"), "u_acc_watch_until", 2),
    element(own("u_acc_fix", "problem-fix"), "u_acc_fix", 3),
  ],
  onView: ["cause_code", "u_acc_rca_method", "u_acc_watch_until", "u_acc_fix"],
};

describe("the record of sections a pack's modules add to", () => {
  it("is empty before the first install, and when it cannot be read", () => {
    expect(formRecordOf(null)).toEqual([]);
    expect(formRecordOf("not json")).toEqual([]);
    expect(formRecordOf('{"sections": "no"}')).toEqual([]);
    expect(formRecordOf("null")).toEqual([]);
  });

  it("keeps only complete entries", () => {
    const text = JSON.stringify({ sections: [RECORD, { module: "x" }, 3] });
    expect(formRecordOf(text)).toEqual([RECORD]);
  });

  it("is the same text for the same entries, sorted and once each", () => {
    const other = { ...RECORD, module: "problem-fix" };
    const text = formRecordText([RECORD, other, RECORD]);
    expect(text).toBe(formRecordText([other, RECORD]));
    expect(formRecordOf(text)).toEqual([other, RECORD]);
    expect(text.endsWith("}\n")).toBe(true);
  });
});

describe("a field the module dropped", () => {
  it("is the module's own element no fact makes any more", () => {
    expect(droppedElements("itsm", RECORD, STATE, [fact("u_acc_rca_method")])).toEqual([
      own("u_acc_watch_until"),
    ]);
  });

  it("is never another module's element nor the client's, and nothing on a missing section", () => {
    expect(droppedElements("itsm", RECORD, STATE, [])).toEqual([
      own("u_acc_rca_method"),
      own("u_acc_watch_until"),
    ]);
    expect(droppedElements("itsm", RECORD, { ...STATE, sysId: null }, [])).toEqual([]);
  });

  it("leaves the restated section with every other element in order", () => {
    const dropped = new Set([own("u_acc_watch_until")]);
    const { elements } = placedElements("itsm", STATE, [fact("u_acc_rca_method")], dropped);
    expect(elements.map((e) => e.element)).toEqual(["cause_code", "u_acc_rca_method", "u_acc_fix"]);
  });
});
