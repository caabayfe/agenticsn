import { describe, expect, it } from "bun:test";
import { dataOrder, type Manifest, parseManifest, selectCapabilities } from "@snagentic/core";
import fc from "fast-check";

// The ITSM pack's shape (spec 005 plan, section 4.3), small.
const ITSM = {
  id: "itsm",
  version: "1.0.0",
  requires: { snagentic: ">=1.8.0" },
  scope: "x_nttdata_acc",
  capabilities: {
    foundation: {
      wave: 0,
      label: "ITSM accelerator: foundation",
      plugins: [{ id: "com.snc.cmdb.csdm", minVersion: null, entitlement: "free" }],
      data: [
        { entity: "company", table: "x_nttdata_acc_imp_company", key: ["name"], after: [] },
        {
          entity: "location",
          table: "x_nttdata_acc_imp_location",
          key: ["name"],
          after: ["company"],
        },
      ],
    },
    incident: {
      wave: 1,
      label: "ITSM accelerator: incident",
      dependsOn: ["foundation"],
      plugins: [],
      data: [
        { entity: "group", table: "x_nttdata_acc_imp_group", key: ["name"], after: ["location"] },
      ],
    },
    on_call: {
      wave: 1,
      label: "ITSM accelerator: on-call",
      dependsOn: ["incident"],
      plugins: [{ id: "com.snc.on_call_rotation", minVersion: "1.0", entitlement: "free" }],
    },
  },
};

const parsed = (document: unknown): Manifest => {
  const outcome = parseManifest(document);
  if (!outcome.ok) throw new Error(outcome.problems.join("; "));
  return outcome.manifest;
};
const problems = (document: unknown): readonly string[] => {
  const outcome = parseManifest(document);
  return outcome.ok ? [] : outcome.problems;
};
const withCapabilities = (capabilities: Record<string, unknown>) => ({ ...ITSM, capabilities });

describe("accelerator manifest (ADR-0026)", () => {
  it("reads a pack's identity, scope and capabilities, with their plugins and data", () => {
    const manifest = parsed(ITSM);
    expect(manifest).toMatchObject({ id: "itsm", version: "1.0.0", scope: "x_nttdata_acc" });
    expect(manifest.requires).toEqual({ snagentic: ">=1.8.0" });
    expect(manifest.capabilities.map((c) => c.id)).toEqual(["foundation", "incident", "on_call"]);
    expect(manifest.capabilities[2]).toEqual({
      id: "on_call",
      wave: 1,
      label: "ITSM accelerator: on-call",
      dependsOn: ["incident"],
      plugins: [{ id: "com.snc.on_call_rotation", minVersion: "1.0", entitlement: "free" }],
      data: [],
    });
  });

  it("says what is missing or malformed, field by field", () => {
    expect(problems(null)).toEqual(["the manifest is not a mapping"]);
    expect(problems({ ...ITSM, id: "ITSM pack", version: "one", scope: "nttdata" })).toEqual([
      "id must be lowercase letters, digits, - or _",
      "version must be major.minor.patch",
      "scope must be x_<vendor>_<name>",
    ]);
    expect(problems({ ...ITSM, capabilities: {} })).toEqual(["capabilities: at least one"]);
    expect(
      problems(withCapabilities({ a: { wave: -1, label: "", plugins: [{ id: "" }], data: [{}] } })),
    ).toEqual([
      "capability a: wave must be a whole number from 0",
      "capability a: label is missing",
      "capability a: plugin 1 needs an id",
      "capability a: data 1 needs entity, table and key",
    ]);
  });

  it("rejects a dependency on a capability the pack does not have", () => {
    expect(problems(withCapabilities({ a: { wave: 0, label: "A", dependsOn: ["b"] } }))).toEqual([
      "capability a depends on b, which the pack does not have",
    ]);
  });

  it("rejects a cyclic dependsOn", () => {
    expect(
      problems(
        withCapabilities({
          a: { wave: 0, label: "A", dependsOn: ["b"] },
          b: { wave: 0, label: "B", dependsOn: ["a"] },
        }),
      ),
    ).toEqual(["capabilities depend on each other in a cycle: a → b → a"]);
  });

  it("rejects a capability in an earlier wave than one it depends on", () => {
    expect(
      problems(
        withCapabilities({
          a: { wave: 1, label: "A" },
          b: { wave: 0, label: "B", dependsOn: ["a"] },
        }),
      ),
    ).toEqual(["capability b (wave 0) depends on a, which is in a later wave (1)"]);
  });

  it("rejects a data entity named twice, and an after that names no entity it can reach", () => {
    const entity = (name: string, after: string[] = []) => ({
      entity: name,
      table: `x_t_${name}`,
      key: ["name"],
      after,
    });
    expect(
      problems(
        withCapabilities({
          a: { wave: 0, label: "A", data: [entity("x"), entity("x")] },
          b: { wave: 0, label: "B", data: [entity("y", ["z"])] },
          c: { wave: 1, label: "C", dependsOn: ["a"], data: [entity("w", ["y"])] },
        }),
      ),
    ).toEqual([
      "data entity x is defined more than once",
      "data entity y loads after z, which the pack does not define",
      "data entity w loads after y, which capability c does not reach (depend on b)",
    ]);
  });

  it("rejects data entities that must load after each other", () => {
    expect(
      problems(
        withCapabilities({
          a: {
            wave: 0,
            label: "A",
            data: [
              { entity: "x", table: "x_t_x", key: ["name"], after: ["y"] },
              { entity: "y", table: "x_t_y", key: ["name"], after: ["x"] },
            ],
          },
        }),
      ),
    ).toEqual(["data entities load after each other in a cycle: x → y → x"]);
  });
});

describe("selecting capabilities", () => {
  const manifest = parsed(ITSM);

  it("selects a wave with the earlier capabilities it depends on, dependencies first", () => {
    expect(selectCapabilities(manifest, { waves: [1] })).toEqual({
      capabilities: ["foundation", "incident", "on_call"],
      unknown: [],
    });
    expect(selectCapabilities(manifest, { waves: [0] }).capabilities).toEqual(["foundation"]);
  });

  it("selects named capabilities with what they depend on, and reports names it does not know", () => {
    expect(selectCapabilities(manifest, { capabilities: ["incident", "problem"] })).toEqual({
      capabilities: ["foundation", "incident"],
      unknown: ["problem"],
    });
  });

  it("selects everything when nothing is named", () => {
    expect(selectCapabilities(manifest, {}).capabilities).toEqual([
      "foundation",
      "incident",
      "on_call",
    ]);
  });

  it("orders data entities so each loads after the ones it names", () => {
    const selected = selectCapabilities(manifest, { waves: [1] }).capabilities;
    expect(dataOrder(manifest, selected).map((e) => e.entity)).toEqual([
      "company",
      "location",
      "group",
    ]);
  });

  it("always selects every dependency of what it selects, and orders them first (property)", () => {
    const ids = manifest.capabilities.map((c) => c.id);
    fc.assert(
      fc.property(fc.subarray(ids), (asked) => {
        const { capabilities } = selectCapabilities(manifest, { capabilities: asked });
        for (const [index, id] of capabilities.entries()) {
          const capability = manifest.capabilities.find((c) => c.id === id);
          for (const dependency of capability?.dependsOn ?? []) {
            const at = capabilities.indexOf(dependency);
            expect(at).toBeGreaterThanOrEqual(0);
            expect(at).toBeLessThan(index);
          }
        }
        for (const id of asked) expect(capabilities).toContain(id);
      }),
    );
  });
});
