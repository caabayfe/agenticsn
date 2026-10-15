import { describe, expect, it } from "bun:test";
import { type ListLayout, listLayoutXml, listUpdateName } from "@snagentic/core";

const LIST = "b0ce1c6d1d0a13878244c122d6a777b2";
const SCOPE = { name: "x_acme_app", sysId: "24585a3c3484e481f8994b3c68c5d588" };

const column = (sysId: string, element: string, position: number, sum = false) => ({
  sysId,
  element,
  position: String(position),
  sum: String(sum),
  maxValue: "false",
  minValue: "false",
  averageValue: "false",
});

const layout = (overrides: Partial<ListLayout> = {}): ListLayout => ({
  sysId: LIST,
  table: "x_acme_app_task",
  view: { sysId: "Default view", name: "" },
  domain: "global",
  columns: [column("a".repeat(32), "state", 1), column("b".repeat(32), "number", 0, true)],
  ...overrides,
});

describe("list layout update (ADR-0029)", () => {
  it("writes the whole list as one composite record, columns in position order", () => {
    const xml = listLayoutXml(layout(), SCOPE);
    expect(xml).toStartWith(
      '<?xml version="1.0"?>\n<record_update>\n  <sys_ui_list table="x_acme_app_task" parent="" relationship="" sys_domain="global" view="">\n',
    );
    expect(xml.indexOf("<element>number</element>")).toBeLessThan(
      xml.indexOf("<element>state</element>"),
    );
    expect(xml).toContain(
      `<list_id display_value="x_acme_app_task" name="x_acme_app_task" view="Default view" sys_domain="global" element="NULL" relationship="NULL" parent="NULL">${LIST}</list_id>`,
    );
    expect(xml).toContain("<position>0</position>\n      <min_value>false</min_value>");
    expect(xml).toContain("<sum>true</sum>");
    expect(xml).toContain(
      `<sys_ui_list action="INSERT_OR_UPDATE" apply_defaults="true">\n      <sys_id>${LIST}</sys_id>\n      <sys_scope display_value="x_acme_app">${SCOPE.sysId}</sys_scope>\n      <view name="NULL">Default view</view>\n      <name>x_acme_app_task</name>\n      <sys_domain>global</sys_domain>\n    </sys_ui_list>`,
    );
    expect(xml).toEndWith("  </sys_ui_list>\n</record_update>");
  });

  it("names a view other than the default by its name, and refers to it by sys_id", () => {
    const view = { sysId: "c".repeat(32), name: "mobile" };
    const xml = listLayoutXml(layout({ view }), SCOPE);
    expect(xml).toContain('sys_domain="global" view="mobile">');
    expect(xml).toContain(`<view name="mobile">${view.sysId}</view>`);
    expect(xml).toContain(`view="${view.sysId}" sys_domain="global" element="NULL"`);
  });

  it("escapes text and attribute values", () => {
    const xml = listLayoutXml(layout({ columns: [column("a".repeat(32), 'a<b&"c', 0)] }), SCOPE);
    expect(xml).toContain('<element>a&lt;b&amp;"c</element>');
  });

  it("is named as the platform records it: table and view, plus the domain outside global", () => {
    expect(listUpdateName(layout())).toBe("sys_ui_list_x_acme_app_task_null");
    expect(listUpdateName(layout({ view: { sysId: "c".repeat(32), name: "Mobile" } }))).toBe(
      "sys_ui_list_x_acme_app_task_Mobile",
    );
    expect(listUpdateName(layout({ domain: "d".repeat(32) }))).toBe(
      `sys_ui_list_x_acme_app_task_null_${"d".repeat(32)}`,
    );
  });
});
