import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stampedXml } from "@snagentic/core";
import { builtUnitOf } from "../../../src/adapters/fluent/built-units";

// The stamp push gives each loaded unit's head record (ADR-0030 item 5), on files the embedded
// SDK built on pdi2.
const FIXTURES = join(import.meta.dir, "../../../../../tests/fixtures/sdk/units");
const NOW = new Date(Date.UTC(2026, 9, 16, 12, 30, 0));

function stamped(name: string) {
  const xml = readFileSync(join(FIXTURES, name), "utf8");
  const unit = builtUnitOf(name, xml);
  const after = builtUnitOf(name, stampedXml(xml, unit.head.table, "7", NOW));
  return { before: unit, after };
}

describe("stampedXml (ADR-0030 item 5)", () => {
  for (const name of [
    "sys_script_include_123833b4d97d48be8e9ec5ea16f27764.xml",
    "sys_choice_x_2222332_s11_e2e_status.xml",
    "sys_ui_section_6c5959ed32b6cecd7fcba3ab09bea2ca.xml",
    "sys_ui_list_x_2222332_acc_rev_revocation_null.xml",
    "sys_ui_form_sections_f67d29c0e4f7611262bd5c7ae69ce0d8.xml",
  ]) {
    it(`stamps the head record of ${name} and nothing else`, () => {
      const { before, after } = stamped(name);
      expect(after.head.fields["sys_mod_count"]).toBe("7");
      expect(after.head.fields["sys_updated_on"]).toBe("2026-10-16 12:30:00");
      const { sys_mod_count: _, sys_updated_on: __, ...rest } = after.head.fields;
      expect(rest).toEqual(before.head.fields);
      expect(after.children).toEqual(before.children);
    });
  }
});
