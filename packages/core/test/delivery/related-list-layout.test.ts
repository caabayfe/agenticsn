import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type RelatedListLayout,
  relatedListLayoutXml,
  relatedListUpdateName,
} from "@snagentic/core";

// The update pdi2 recorded when spike S15 loaded this related list (ADR-0030).
const RECORDED = readFileSync(
  join(import.meta.dir, "../../../../tests/fixtures/layouts/related-list-recorded-pdi2.xml"),
  "utf8",
);
const SCOPE = { name: "x_2222332_s11", sysId: "489da54ae67c4a3e9f1e1e4347e9119b" };
const entry = (sysId: string, relatedList: string, position: string) => ({
  sysId,
  relatedList,
  position,
  filter: "",
  orderBy: "",
  groupByField: "",
});
const LAYOUT: RelatedListLayout = {
  sysId: "38b434524afe4d3e912f98e020181d08",
  table: "x_2222332_s11_list_probe",
  view: { sysId: "Default view", name: "" },
  domain: "global",
  entries: [
    entry("8b76b88224b74a868db1ca75e4b8fb2a", "sys_journal_field.element_id", "1"),
    entry("73f8837847504fafaf51544e03e27896", "sys_audit.documentkey", "0"),
  ],
};

describe("related lists update (ADR-0030)", () => {
  it("writes the update the platform recorded, entries in position order", () => {
    expect(relatedListLayoutXml(LAYOUT, SCOPE)).toBe(RECORDED);
  });

  it("is named after the table and view, plus the domain outside global", () => {
    expect(relatedListUpdateName(LAYOUT)).toBe("sys_ui_related_x_2222332_s11_list_probe_null");
    const mobile = { ...LAYOUT, view: { sysId: "d".repeat(32), name: "Mobile" } };
    expect(relatedListUpdateName(mobile)).toBe("sys_ui_related_x_2222332_s11_list_probe_Mobile");
    expect(relatedListLayoutXml(mobile, SCOPE)).toContain(
      `<view display_value="Mobile" name="Mobile">${"d".repeat(32)}</view>`,
    );
    expect(relatedListUpdateName({ ...LAYOUT, domain: "9".repeat(32) })).toBe(
      `sys_ui_related_x_2222332_s11_list_probe_null_${"9".repeat(32)}`,
    );
  });
});
