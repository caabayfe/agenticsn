import { describe, expect, it } from "bun:test";
import { dataOrder, type Manifest, parseManifest, selectCapabilities } from "@snagentic/core";
import fc from "fast-check";

// The ITSM pack's shape (spec 005 plan, section 4.3), small, as packDocument assembles it from
// accelerator.yaml and each modules/<module>/module.yaml (format 2, ADR-0038).
const ITSM = {
  id: "itsm",
  version: "1.0.0",
  requires: { snagentic: ">=1.8.0" },
  platform: { tested: ["Australia", "zurich"] },
  profiles: { core: ["incident"], everything: ["on_call", "foundation"] },
  modules: {
    foundation: {
      label: "ITSM accelerator: foundation",
      components: [
        { kind: "plugin", id: "com.snc.cmdb.csdm", minVersion: null, entitlement: "free" },
      ],
      data: [
        { entity: "company", table: "x_nttdata_acc_imp_company", key: ["name"], after: [] },
        {
          entity: "location",
          table: "x_nttdata_acc_imp_location",
          key: ["name"],
          after: ["company"],
          anchors: true,
        },
      ],
    },
    incident: {
      label: "ITSM accelerator: incident",
      dependsOn: ["foundation"],
      components: [],
      data: [
        { entity: "group", table: "x_nttdata_acc_imp_group", key: ["name"], after: ["location"] },
      ],
    },
    on_call: {
      label: "ITSM accelerator: on-call",
      dependsOn: ["incident"],
      components: [
        { kind: "plugin", id: "com.snc.on_call_rotation", minVersion: "1.0", entitlement: "free" },
        { kind: "app", id: "sn_oncall_mobile", minVersion: "2.1.0", entitlement: "licensed" },
      ],
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
const withModules = (modules: Record<string, unknown>) => {
  const { profiles: _, ...rest } = ITSM;
  return { ...rest, modules };
};

describe("accelerator manifest (ADR-0026, ADR-0038)", () => {
  it("reads a pack's identity, tested platforms, profiles and modules, with their components and data", () => {
    const manifest = parsed(ITSM);
    expect(manifest).toMatchObject({ id: "itsm", version: "1.0.0" });
    expect(manifest.requires).toEqual({ snagentic: ">=1.8.0" });
    expect(manifest.tested).toEqual(["australia", "zurich"]);
    expect(manifest.profiles).toEqual({
      core: ["incident"],
      everything: ["on_call", "foundation"],
    });
    expect(manifest.capabilities.map((c) => c.id)).toEqual(["foundation", "incident", "on_call"]);
    expect(manifest.capabilities[2]).toEqual({
      id: "on_call",
      label: "ITSM accelerator: on-call",
      dependsOn: ["incident"],
      components: [
        { kind: "plugin", id: "com.snc.on_call_rotation", minVersion: "1.0", entitlement: "free" },
        { kind: "app", id: "sn_oncall_mobile", minVersion: "2.1.0", entitlement: "licensed" },
      ],
      data: [],
    });
    expect(manifest.capabilities[0]?.data.map((d) => [d.entity, d.anchors])).toEqual([
      ["company", false],
      ["location", true],
    ]);
  });

  it("names a module without a label after its pack", () => {
    expect(parsed(withModules({ base: {} })).capabilities[0]?.label).toBe("itsm/base");
  });

  it("records no tested platform and no profile when the pack names none", () => {
    const { platform: _, ...untested } = withModules({ base: {} });
    expect(parsed(untested)).toMatchObject({ tested: [], profiles: {} });
  });

  it("says what is missing or malformed, field by field", () => {
    expect(problems(null)).toEqual(["the manifest is not a mapping"]);
    expect(problems({ ...ITSM, id: "ITSM pack", version: "one" })).toEqual([
      "id must be lowercase letters, digits, - or _",
      "version must be major.minor.patch",
    ]);
    expect(problems(withModules({}))).toEqual([
      "modules: at least one (modules/<module>/module.yaml)",
    ]);
    expect(problems(withModules({ A: { components: [{ id: "" }], data: [{}] } }))).toEqual([
      "module A: its folder name must be lowercase letters, digits, - or _",
      "module A: component 1 needs an id",
      "module A: data 1 needs entity, table and key",
    ]);
  });

  it("rejects a profile naming a module the pack does not have, or none", () => {
    expect(
      problems({
        ...ITSM,
        profiles: { core: ["incident", "problem"], empty: [], Bad: ["incident"] },
      }),
    ).toEqual([
      "profile core names problem, which the pack does not have",
      "profile empty: names no module",
      "profile Bad: lowercase letters, digits, - or _",
    ]);
  });

  it("rejects a dependency on a module the pack does not have", () => {
    expect(problems(withModules({ a: { dependsOn: ["b"] } }))).toEqual([
      "module a depends on b, which the pack does not have",
    ]);
  });

  it("rejects a cyclic dependsOn", () => {
    expect(problems(withModules({ a: { dependsOn: ["b"] }, b: { dependsOn: ["a"] } }))).toEqual([
      "modules depend on each other in a cycle: a → b → a",
    ]);
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
        withModules({
          a: { data: [entity("x"), entity("x")] },
          b: { data: [entity("y", ["z"])] },
          c: { dependsOn: ["a"], data: [entity("w", ["y"])] },
        }),
      ),
    ).toEqual([
      "data entity x is defined more than once",
      "data entity y loads after z, which the pack does not define",
      "data entity w loads after y, which module c does not reach (depend on b)",
    ]);
  });

  it("rejects data entities that must load after each other", () => {
    expect(
      problems(
        withModules({
          a: {
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

describe("selecting modules", () => {
  const manifest = parsed(ITSM);

  it("selects a profile's modules with the modules they depend on, dependencies first", () => {
    expect(selectCapabilities(manifest, { profile: "core" })).toEqual({
      capabilities: ["foundation", "incident"],
      unknown: [],
    });
    expect(selectCapabilities(manifest, { profile: "everything" }).capabilities).toEqual([
      "foundation",
      "incident",
      "on_call",
    ]);
  });

  it("reports a profile the pack does not have, and selects nothing for it", () => {
    expect(selectCapabilities(manifest, { profile: "full" })).toEqual({
      capabilities: [],
      unknown: ["profile full"],
    });
  });

  it("adds named modules to a profile's", () => {
    expect(
      selectCapabilities(manifest, { profile: "core", modules: ["on_call"] }).capabilities,
    ).toEqual(["foundation", "incident", "on_call"]);
  });

  it("selects named modules with what they depend on, and reports names it does not know", () => {
    expect(selectCapabilities(manifest, { modules: ["incident", "problem"] })).toEqual({
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

  it("orders data entities so each loads after the ones it names, with its module", () => {
    const selected = selectCapabilities(manifest, { profile: "core" }).capabilities;
    expect(dataOrder(manifest, selected).map((e) => [e.entity, e.module])).toEqual([
      ["company", "foundation"],
      ["location", "foundation"],
      ["group", "incident"],
    ]);
  });

  it("always selects every dependency of what it selects, and orders them first (property)", () => {
    const ids = manifest.capabilities.map((c) => c.id);
    fc.assert(
      fc.property(fc.subarray(ids), (asked) => {
        const { capabilities } = selectCapabilities(manifest, { modules: asked });
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
