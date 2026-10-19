import { describe, expect, it } from "bun:test";
import { materialize } from "@snagentic/core";

const SLA = "3d5fd9f1c0a8016400cbc76ea0b4c9a4";
const CONFIG = '{ "scope": "x_snagentic_min" }\n';

// What the pack holds for two modules, as files under the pack directory (format 2, ADR-0038).
const PACK = new Map([
  ["accelerator.yaml", "id: minimal\n"],
  ["README.md", "# minimal\n"],
  ["modules/base/module.yaml", "label: base\n"],
  ["modules/base/README.md", "# base\n"],
  ["modules/base/data/demo/location.csv", "name,city\n"],
  ["modules/base/source/global/src/fluent/app.now.ts", "Record({})\n"],
  ["modules/base/source/x_snagentic_min/now.config.json", CONFIG],
  ["modules/base/source/x_snagentic_min/src/fluent/properties.now.ts", "Record({})\n"],
  ["modules/extra/module.yaml", "label: extra\n"],
  ["modules/extra/source/x_snagentic_min/now.config.json", CONFIG],
  ["modules/extra/source/x_snagentic_min/src/fluent/rule.now.ts", "BusinessRule({})\n"],
  [
    "modules/base/adopt.yaml",
    JSON.stringify([{ table: "contract_sla", sys_id: SLA, note: "set duration to 4 hours" }]),
  ],
]);

// Adopt files written as JSON, which is YAML too.
const parse = (text: string): unknown => JSON.parse(text);
const run = (selected: readonly string[], pack: ReadonlyMap<string, string> = PACK) =>
  materialize({ selected, files: pack, parse });

describe("materializing a pack (ADR-0026, ADR-0031, ADR-0038)", () => {
  it("copies the selected modules' Fluent source into the workspace's projects", () => {
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

  it("never copies the manifests, the READMEs or the demo data", () => {
    const paths = run(["base", "extra"]).files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith(".md") || p.endsWith(".yaml") || p.endsWith(".csv"))).toBe(
      false,
    );
  });

  it("leaves out the modules not selected", () => {
    const { files, adoptions } = run(["extra"]);
    expect(files.map((f) => f.path)).toEqual([
      "source/x_snagentic_min/now.config.json",
      "source/x_snagentic_min/src/fluent/rule.now.ts",
    ]);
    expect(adoptions).toEqual([]);
  });

  it("lists the out-of-box records a module customizes, with what to change after adopting", () => {
    expect(run(["base"]).adoptions).toEqual([
      { capability: "base", table: "contract_sla", sysId: SLA, note: "set duration to 4 hours" },
    ]);
  });

  it("names each malformed adoption, and an adopt file that is not a list", () => {
    const bad = new Map([
      [
        "modules/base/adopt.yaml",
        JSON.stringify([
          { table: "contract_sla", sys_id: SLA },
          { table: "incident", sys_id: "x", note: "n" },
          3,
        ]),
      ],
      ["modules/extra/adopt.yaml", '{ "table": "incident" }'],
    ]);
    expect(run(["base", "extra"], bad).problems).toEqual([
      "modules/base/adopt.yaml: entry 1 needs table, sys_id (32 hexadecimal characters) and note",
      "modules/base/adopt.yaml: entry 2 needs table, sys_id (32 hexadecimal characters) and note",
      "modules/base/adopt.yaml: entry 3 needs table, sys_id (32 hexadecimal characters) and note",
      "modules/extra/adopt.yaml: a list of { table, sys_id, note }",
    ]);
  });

  it("refuses a pack file outside modules/<module>/, or a module file outside a project folder", () => {
    const odd = new Map([
      ["modules/base/readme.txt", "x"],
      ["scripts/x.sh", "y"],
      ["source/base/global/src/fluent/app.now.ts", "z"],
    ]);
    expect(run(["base"], odd).problems).toEqual([
      "modules/base/readme.txt: not in a project folder (modules/<module>/source/<scope>/...)",
      "scripts/x.sh: not under modules/<module>/ (ADR-0038)",
      "source/base/global/src/fluent/app.now.ts: not under modules/<module>/ (ADR-0038)",
    ]);
  });

  it("refuses two modules that write different content to the same file", () => {
    const twice = new Map([
      ["modules/base/source/global/src/fluent/x.now.ts", "a"],
      ["modules/extra/source/global/src/fluent/x.now.ts", "b"],
    ]);
    expect(run(["base", "extra"], twice).problems).toEqual([
      "source/global/src/fluent/x.now.ts is written by both base and extra",
    ]);
  });
});
