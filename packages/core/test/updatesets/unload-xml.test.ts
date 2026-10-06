import { describe, expect, it } from "bun:test";
import { renderUnload } from "@snagentic/core";

// The rules below were checked against an "Export to XML" file published by ServiceNow:
// parsing it and rendering it again reproduces it byte for byte (26,740 bytes, 9 records).
describe("renderUnload", () => {
  it("writes ServiceNow's unload format: sorted fields, references with display values, empty fields self-closing", () => {
    const xml = renderUnload("2026-10-06 12:00:00", [
      {
        table: "sys_update_xml",
        action: "INSERT_OR_UPDATE",
        fields: [
          { name: "name", value: "sys_script_include_1" },
          { name: "comments", value: "" },
          { name: "application", value: "global", display: "Global" },
          { name: "update_set", value: "", display: "" },
          { name: "description", value: " " },
        ],
      },
    ]);
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<unload unload_date="2026-10-06 12:00:00">',
        '<sys_update_xml action="INSERT_OR_UPDATE">',
        '<application display_value="Global">global</application>',
        "<comments/>",
        "<description> </description>",
        "<name>sys_script_include_1</name>",
        '<update_set display_value=""/>',
        "</sys_update_xml>",
        "</unload>",
        "",
      ].join("\n"),
    );
  });

  const one = (value: string, display?: string) =>
    renderUnload("d", [
      {
        table: "t",
        action: "INSERT_OR_UPDATE",
        fields: [display === undefined ? { name: "f", value } : { name: "f", value, display }],
      },
    ]).split("\n")[3];

  it("wraps a value with markup in CDATA, keeping quotes and line breaks", () => {
    expect(one('<?xml version="1.0"?><a>x && y</a>')).toBe(
      '<f><![CDATA[<?xml version="1.0"?><a>x && y</a>]]></f>',
    );
    const multiline = renderUnload("d", [
      { table: "t", action: "INSERT_OR_UPDATE", fields: [{ name: "f", value: "<a>\n</a>" }] },
    ]);
    expect(multiline).toContain("<f><![CDATA[<a>\n</a>]]></f>");
  });

  it("escapes a value that holds a CDATA section of its own", () => {
    expect(one("<s><![CDATA[a < b]]></s>")).toBe(
      "<f>&lt;s&gt;&lt;![CDATA[a &lt; b]]&gt;&lt;/s&gt;</f>",
    );
  });

  it("escapes display values in their attribute", () => {
    expect(one("x", 'Say "hi" <b> & go')).toBe(
      '<f display_value="Say &quot;hi&quot; &lt;b&gt; &amp; go">x</f>',
    );
  });
});
