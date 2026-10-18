import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UnreadableBuildError } from "@snagentic/core";
import { builtUnitOf, isEmptyUpdate } from "../../../src/adapters/fluent/built-units";

// Files the embedded SDK (4.13.6) built on pdi2 in spikes S16 and S17.
const FIXTURES = join(import.meta.dir, "../../../../../tests/fixtures/sdk/units");
const unit = (name: string) => builtUnitOf(name, readFileSync(join(FIXTURES, name), "utf8"));

describe("builtUnitOf (ADR-0033 item 1)", () => {
  it("reads a record unit, its fields and its update name", () => {
    const built = unit("sys_script_include_123833b4d97d48be8e9ec5ea16f27764.xml");
    expect(built.updateName).toBe("sys_script_include_123833b4d97d48be8e9ec5ea16f27764");
    expect(built.head).toMatchObject({
      table: "sys_script_include",
      sysId: "123833b4d97d48be8e9ec5ea16f27764",
      action: "INSERT_OR_UPDATE",
    });
    expect(built.head.fields["name"]).toBe("E2EUtil");
    expect(built.head.fields["description"]).toBe("");
    expect(built.children).toEqual([]);
  });

  it("decodes character references, as the instance stores the text", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><record_update table="x_t"><x_t action="INSERT_OR_UPDATE"><sys_id>0123456789abcdef0123456789abcdef</sys_id><description>a&#13;\nb &amp;#13; c &#x41; &lt;d&gt;</description><script><![CDATA[keep &#13; raw]]></script></x_t></record_update>`;
    expect(builtUnitOf("x_t_1.xml", xml).head.fields).toMatchObject({
      description: "a\r\nb &#13; c A <d>",
      script: "keep &#13; raw",
    });
  });

  it("reads a column as a dictionary unit, coalesced by table and column", () => {
    const built = unit("sys_dictionary_x_2222332_acc_rev_campaign_review_type.xml");
    expect(built.head.table).toBe("sys_dictionary");
    expect(built.head.fields).toMatchObject({
      name: "x_2222332_acc_rev_campaign",
      element: "review_type",
    });
  });

  it("reads a list with its columns, and the default view's name", () => {
    const built = unit("sys_ui_list_x_2222332_acc_rev_revocation_null.xml");
    expect(built.head.table).toBe("sys_ui_list");
    expect(built.head.referenceNames["view"]).toBe("NULL");
    expect(built.children.map((c) => c.table)).toEqual(
      built.children.map(() => "sys_ui_list_element"),
    );
    expect(built.children.map((c) => c.fields["element"]).slice(0, 2)).toEqual([
      "number",
      "subject_user",
    ]);
  });

  it("reads a section with its elements, column markers included", () => {
    const built = unit("sys_ui_section_6c5959ed32b6cecd7fcba3ab09bea2ca.xml");
    expect(built.head).toMatchObject({
      table: "sys_ui_section",
      sysId: "6c5959ed32b6cecd7fcba3ab09bea2ca",
    });
    expect(built.children[0]?.fields["element"]).toBe(".begin_split");
  });

  it("gives a form the domain its wrapper names, so it is matched like the platform matches it", () => {
    const built = unit("sys_ui_form_sections_f67d29c0e4f7611262bd5c7ae69ce0d8.xml");
    expect(built.head.fields["sys_domain"]).toBe("global");
    expect(built.children.every((row) => row.fields["sys_domain"] === undefined)).toBe(true);
  });

  it("names a form's unit after the form, with its sections as rows", () => {
    const built = unit("sys_ui_form_sections_f67d29c0e4f7611262bd5c7ae69ce0d8.xml");
    expect(built.head.table).toBe("sys_ui_form");
    expect(built.children.map((c) => c.table)).toEqual(["sys_ui_form_section"]);
  });

  it("names a choice set's unit after the set, with its choices as rows", () => {
    const built = unit("sys_choice_x_2222332_s11_e2e_status.xml");
    expect(built.head.table).toBe("sys_choice_set");
    expect(built.children.map((c) => c.fields["value"]).sort()).toEqual([
      "closed",
      "open",
      "pending",
    ]);
  });

  it("reads a flow with its gzipped payloads opened, so two builds digest alike", () => {
    const built = unit("sys_hub_flow_8a924849cd84412081573bb363ec4326.xml");
    expect(built.head.table).toBe("sys_hub_flow");
    const values = built.children.flatMap((c) => Object.values(c.fields));
    expect(values.some((v) => v.startsWith("H4sI"))).toBe(false);
  });

  it("reads a Now.del as a deletion", () => {
    expect(unit("sys_properties_99171e3ec14343a9b2903cbbe455a95d.xml").head.action).toBe("DELETE");
  });

  // An adopted flow's rebuild writes its snapshot as a declaration alone (SDK 4.13.6, pdi2).
  it("knows an update file with no element holds nothing to load", () => {
    expect(isEmptyUpdate('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(isEmptyUpdate('<?xml version="1.0"?><unload/>')).toBe(false);
  });

  it("refuses a file that is not an update record", () => {
    expect(() => builtUnitOf("x.xml", '<?xml version="1.0"?><unload/>')).toThrow(
      UnreadableBuildError,
    );
  });
});
