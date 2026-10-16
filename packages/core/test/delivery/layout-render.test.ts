import { describe, expect, it } from "bun:test";
import {
  formLayoutXml,
  layoutUpdateName,
  layoutXml,
  type PlannedLayout,
  relatedListLayoutXml,
  sectionLayoutXml,
} from "@snagentic/core";

const SCOPE = { name: "x_acme_app", sysId: "s".repeat(32) };
const DEFAULT = { sysId: "Default view", name: "" };
const ID = "a".repeat(32);

const planned = (kind: PlannedLayout["kind"], extra: Partial<PlannedLayout>): PlannedLayout => ({
  kind,
  operation: "update",
  path: "p.yaml",
  scope: "x_acme_app",
  sysId: ID,
  table: "x_acme_app_task",
  view: DEFAULT,
  domain: "global",
  fields: {},
  rows: [],
  updateName: "",
  sections: {},
  base: null,
  ...extra,
});

describe("planned layouts rendered by their kind's writer (ADR-0030)", () => {
  it("renders a form section, defaulting its flags", () => {
    const layout = planned("section", {
      fields: { caption: "Notes", roles: "" },
      rows: [
        {
          sys_id: "b".repeat(32),
          element: "number",
          position: "0",
          type: "",
          sys_ui_formatter: "",
        },
      ],
    });
    expect(layoutXml(layout, SCOPE)).toBe(
      sectionLayoutXml(
        {
          sysId: ID,
          table: "x_acme_app_task",
          caption: "Notes",
          view: DEFAULT,
          domain: "global",
          header: "false",
          title: "false",
          roles: "",
          elements: [
            { sysId: "b".repeat(32), element: "number", position: "0", type: "", formatter: "" },
          ],
        },
        SCOPE,
      ),
    );
    expect(layoutUpdateName(layout)).toBe(`sys_ui_section_${ID}`);
  });

  it("renders a form with its sections as the platform matches them, or as the form's own", () => {
    const [known, unknown] = ["c".repeat(32), "d".repeat(32)];
    const layout = planned("form", {
      fields: { roles: "itil" },
      rows: [
        { sys_id: "1".repeat(32), position: "0", sys_ui_section: known },
        { sys_id: "2".repeat(32), position: "1", sys_ui_section: unknown },
      ],
      sections: { [known]: { caption: "Notes", domain: "global", viewSysId: "Default view" } },
    });
    expect(layoutXml(layout, SCOPE)).toBe(
      formLayoutXml(
        {
          sysId: ID,
          table: "x_acme_app_task",
          view: DEFAULT,
          domain: "global",
          roles: "itil",
          sections: [
            {
              sysId: "1".repeat(32),
              position: "0",
              section: {
                sysId: known,
                caption: "Notes",
                domain: "global",
                viewSysId: "Default view",
              },
            },
            {
              sysId: "2".repeat(32),
              position: "1",
              section: { sysId: unknown, caption: "", domain: "global", viewSysId: "Default view" },
            },
          ],
        },
        SCOPE,
      ),
    );
    expect(layoutUpdateName(layout)).toBe(`sys_ui_form_sections_${ID}`);
  });

  it("escapes a related list entry's text", () => {
    const xml = relatedListLayoutXml(
      {
        sysId: ID,
        table: "t",
        view: DEFAULT,
        domain: "global",
        entries: [
          {
            sysId: "b".repeat(32),
            relatedList: "task.parent",
            position: "0",
            filter: "a<b&c",
            orderBy: "",
            groupByField: "",
          },
        ],
      },
      SCOPE,
    );
    expect(xml).toContain("<filter>a&lt;b&amp;c</filter>");
  });
});
