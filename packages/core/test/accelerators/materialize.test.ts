import { describe, expect, it } from "bun:test";
import { materialize } from "@snagentic/core";

const SLA = "3d5fd9f1c0a8016400cbc76ea0b4c9a4";
const CONFIG = '{ "scope": "x_snagentic_min" }\n';

// What the pack holds for two capabilities, as files under the pack directory.
const PACK = new Map([
  ["accelerator.yaml", "id: minimal\n"],
  ["data/location.csv", "name,city\n"],
  ["source/base/global/src/fluent/app.now.ts", "Record({})\n"],
  ["source/base/x_snagentic_min/now.config.json", CONFIG],
  ["source/base/x_snagentic_min/src/fluent/properties.now.ts", "Record({})\n"],
  ["source/extra/x_snagentic_min/now.config.json", CONFIG],
  ["source/extra/x_snagentic_min/src/fluent/rule.now.ts", "BusinessRule({})\n"],
  [
    "adopt/base.yaml",
    JSON.stringify([{ table: "contract_sla", sys_id: SLA, note: "set duration to 4 hours" }]),
  ],
]);

// Adopt files written as JSON, which is YAML too.
const parse = (text: string): unknown => JSON.parse(text);
const run = (selected: readonly string[], pack: ReadonlyMap<string, string> = PACK) =>
  materialize({ selected, files: pack, parse });

describe("materializing a pack (ADR-0026, ADR-0031)", () => {
  it("copies the selected capabilities' Fluent source into the workspace's projects", () => {
    const { files, problems } = run(["base", "extra"]);
    expect(problems).toEqual([]);
    expect(files.map((f) => [f.path, f.capability])).toEqual([
      ["source/global/src/fluent/app.now.ts", "base"],
      ["source/x_snagentic_min/now.config.json", "base"],
      ["source/x_snagentic_min/src/fluent/properties.now.ts", "base"],
      ["source/x_snagentic_min/src/fluent/rule.now.ts", "extra"],
    ]);
    expect(files[0]?.text).toBe("Record({})\n");
  });

  it("leaves out the capabilities not selected", () => {
    const { files, adoptions } = run(["extra"]);
    expect(files.map((f) => f.path)).toEqual([
      "source/x_snagentic_min/now.config.json",
      "source/x_snagentic_min/src/fluent/rule.now.ts",
    ]);
    expect(adoptions).toEqual([]);
  });

  it("lists the out-of-box records a capability customizes, with what to change after adopting", () => {
    expect(run(["base"]).adoptions).toEqual([
      { capability: "base", table: "contract_sla", sysId: SLA, note: "set duration to 4 hours" },
    ]);
  });

  it("names each malformed adoption, and an adopt file that is not a list", () => {
    const bad = new Map([
      [
        "adopt/base.yaml",
        JSON.stringify([
          { table: "contract_sla", sys_id: SLA },
          { table: "incident", sys_id: "x", note: "n" },
          3,
        ]),
      ],
      ["adopt/extra.yaml", '{ "table": "incident" }'],
    ]);
    expect(run(["base", "extra"], bad).problems).toEqual([
      "adopt/base.yaml: entry 1 needs table, sys_id (32 hexadecimal characters) and note",
      "adopt/base.yaml: entry 2 needs table, sys_id (32 hexadecimal characters) and note",
      "adopt/base.yaml: entry 3 needs table, sys_id (32 hexadecimal characters) and note",
      "adopt/extra.yaml: a list of { table, sys_id, note }",
    ]);
  });

  it("refuses a pack in format 1 (YAML records and patches), naming the new layout", () => {
    const old = new Map([
      ["metadata/base/global/sys_properties/x--a9.yaml", "name: x\n"],
      ["patches/base/sla.yaml", "table: contract_sla\n"],
    ]);
    expect(run(["base"], old).problems).toEqual([
      "metadata/base/global/sys_properties/x--a9.yaml and 1 more: pack format 1: YAML records and patches are no longer installed; ship Fluent under source/ and customizations under adopt/",
    ]);
    const one = new Map([["patches/base/sla.yaml", "x"]]);
    expect(run(["base"], one).problems[0]).toStartWith("patches/base/sla.yaml: pack format 1");
  });

  it("refuses a pack file outside source/ and adopt/, or a source file outside a project folder", () => {
    const odd = new Map([
      ["source/base/readme.md", "x"],
      ["scripts/base/x.sh", "y"],
      ["adopt/base/nested.yaml", "z"],
    ]);
    expect(run(["base"], odd).problems).toEqual([
      "adopt/base/nested.yaml: not under source/<capability>/<scope>/ or adopt/<capability>.yaml",
      "scripts/base/x.sh: not under source/<capability>/<scope>/ or adopt/<capability>.yaml",
      "source/base/readme.md: not in a project folder (source/<capability>/<scope>/...)",
    ]);
  });

  it("refuses two capabilities that write different content to the same file", () => {
    const twice = new Map([
      ["source/base/global/src/fluent/x.now.ts", "a"],
      ["source/extra/global/src/fluent/x.now.ts", "b"],
    ]);
    expect(run(["base", "extra"], twice).problems).toEqual([
      "source/global/src/fluent/x.now.ts is written by both base and extra",
    ]);
  });
});
