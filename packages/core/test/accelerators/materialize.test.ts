import { describe, expect, it } from "bun:test";
import { materialize } from "@snagentic/core";

const INCIDENT_SLA = "global/contract_sla/priority-1-resolution--3d5fd9f1c0a8016400cbc76ea0b4c9a4";
const PATCH_ID = "3d5fd9f1c0a8016400cbc76ea0b4c9a4";

// What the pack holds for two capabilities, as files under the pack directory.
const PACK = new Map([
  ["metadata/base/x_snagentic_min/sys_app/min--a1.yaml", "name: min\n"],
  ["metadata/base/x_snagentic_min/sys_properties/x-on--a2.yaml", "name: x_snagentic_min.on\n"],
  ["metadata/extra/global/sys_script/rule--a3.yaml", "name: rule\n"],
  ["metadata/extra/global/sys_script/rule--a3.script.js", "current.update();\n"],
  [
    "patches/base/sla.yaml",
    `table: contract_sla\nsys_id: ${PATCH_ID}\nfields:\n  duration: "1970-01-01 04:00:00"\n`,
  ],
]);

const parsePatch = (text: string): unknown => {
  const sysId = /sys_id: (\w+)/.exec(text)?.[1];
  const duration = /duration: "([^"]+)"/.exec(text)?.[1];
  return { table: "contract_sla", sys_id: sysId, fields: { duration } };
};

const mirrored = (sysId: string) =>
  sysId === PATCH_ID
    ? {
        path: `${INCIDENT_SLA}.yaml`,
        document: {
          _meta: { sys_id: PATCH_ID, hash: "h" },
          name: "P1",
          duration: "1970-01-01 08:00:00",
        },
      }
    : null;

const run = (selected: readonly string[], pack = PACK, find = mirrored) =>
  materialize({ selected, files: pack, parse: parsePatch, mirrored: find });

describe("materializing a pack (ADR-0026)", () => {
  it("copies the selected capabilities' records into the workspace layout, field files included", () => {
    const { files, problems } = run(["base", "extra"]);
    expect(problems).toEqual([]);
    expect(files.filter((f) => f.kind === "copy").map((f) => f.path)).toEqual([
      "x_snagentic_min/sys_app/min--a1.yaml",
      "x_snagentic_min/sys_properties/x-on--a2.yaml",
      "global/sys_script/rule--a3.yaml",
      "global/sys_script/rule--a3.script.js",
    ]);
  });

  it("leaves out the capabilities not selected", () => {
    const { files } = run(["base"]);
    expect(files.some((f) => f.path.startsWith("global/sys_script/"))).toBe(false);
  });

  it("patches the mirrored copy of an out-of-box record: only the named fields, its _meta kept", () => {
    const patched = run(["base"]).files.find((f) => f.kind === "patch");
    expect(patched).toEqual({
      kind: "patch",
      path: `${INCIDENT_SLA}.yaml`,
      document: {
        _meta: { sys_id: PATCH_ID, hash: "h" },
        name: "P1",
        duration: "1970-01-01 04:00:00",
      },
      fields: ["duration"],
    });
  });

  it("is blocked by a patch whose record the instance does not have", () => {
    expect(run(["base"], PACK, () => null).problems).toEqual([
      `patches/base/sla.yaml: contract_sla ${PATCH_ID} is not in the mirror (run accelerator check; it may need a plugin)`,
    ]);
  });

  it("refuses a malformed patch, and one that would change identity fields", () => {
    const bad = new Map([
      ["patches/base/a.yaml", "x"],
      ["patches/base/b.yaml", "y"],
    ]);
    const parse = (text: string) =>
      text === "x"
        ? { table: "t" }
        : { table: "t", sys_id: PATCH_ID, fields: { sys_id: "z", _meta: "m" } };
    expect(materialize({ selected: ["base"], files: bad, parse, mirrored }).problems).toEqual([
      "patches/base/a.yaml: a patch needs table, sys_id and fields",
      "patches/base/b.yaml: a patch may not change sys_id, _meta",
    ]);
  });

  it("refuses a pack file outside metadata/ and patches/, or a metadata path outside the layout", () => {
    const odd = new Map([
      ["metadata/base/readme.md", "x"],
      ["scripts/base/x.sh", "y"],
    ]);
    expect(run(["base"], odd).problems).toEqual([
      "metadata/base/readme.md: not a record file in the workspace layout (<scope>/<class>/<file>)",
      "scripts/base/x.sh: not under metadata/<capability>/ or patches/<capability>/",
    ]);
  });

  it("refuses two capabilities that write the same file", () => {
    const twice = new Map([
      ["metadata/base/global/sys_properties/x--a9.yaml", "a"],
      ["metadata/extra/global/sys_properties/x--a9.yaml", "b"],
    ]);
    expect(run(["base", "extra"], twice).problems).toEqual([
      "global/sys_properties/x--a9.yaml is written by both base and extra",
    ]);
  });

  it("writes a pack record the instance already holds onto its mirrored copy, like a patch", () => {
    const existing = (sysId: string) =>
      sysId === "a2"
        ? {
            path: "x_snagentic_min/sys_properties/x-snagentic-min-on--a2.yaml",
            document: {
              _meta: { sys_id: "a2", hash: "h" },
              name: "x_snagentic_min.on",
              sys_policy: "",
            },
          }
        : sysId === "a3"
          ? {
              path: "global/sys_script/rule-renamed--a3.yaml",
              document: { _meta: { sys_id: "a3" }, name: "rule" },
            }
          : mirrored(sysId);
    const parse = (text: string) =>
      text.startsWith("name: ") ? { name: text.slice(6).trim() } : parsePatch(text);
    const { files, problems } = materialize({
      selected: ["base", "extra"],
      files: PACK,
      parse,
      mirrored: existing,
    });
    expect(problems).toEqual([]);
    expect(files.find((f) => f.path.includes("x-snagentic-min-on"))).toEqual({
      kind: "patch",
      path: "x_snagentic_min/sys_properties/x-snagentic-min-on--a2.yaml",
      document: { _meta: { sys_id: "a2", hash: "h" }, name: "x_snagentic_min.on", sys_policy: "" },
      fields: ["name"],
    });
    // A field file follows its record's mirrored name.
    expect(files.filter((f) => f.path.startsWith("global/sys_script/")).map((f) => f.path)).toEqual(
      ["global/sys_script/rule-renamed--a3.yaml", "global/sys_script/rule-renamed--a3.script.js"],
    );
  });

  it("leaves the fields pull never mirrors (secrets) to the instance, and refuses a patch of one", () => {
    const secret = {
      path: "x_snagentic_min/sys_properties/x-on--a2.yaml",
      document: { _meta: { sys_id: "a2", redacted: ["value"] }, name: "x.on" },
    };
    const parse = (text: string) =>
      text.startsWith("PROP")
        ? { name: "x.on", value: "true" }
        : { table: "sys_properties", sys_id: "a2", fields: { value: "x" } };
    const pack = new Map([
      ["metadata/base/x_snagentic_min/sys_properties/x-on--a2.yaml", "PROP"],
      ["patches/base/p.yaml", "PATCH"],
    ]);
    const { files, problems } = materialize({
      selected: ["base"],
      files: pack,
      parse,
      mirrored: () => secret,
    });
    expect(files).toEqual([
      {
        kind: "patch",
        path: secret.path,
        document: { ...secret.document, name: "x.on" },
        fields: ["name"],
      },
    ]);
    expect(problems).toEqual([
      "patches/base/p.yaml: value is never mirrored (it may hold a secret): set it on the instance",
    ]);
  });
});
