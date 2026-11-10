import { describe, expect, it } from "bun:test";
import { checkMirrorScope, InstanceName, MirrorScopeError } from "../../src";

const PDI = InstanceName.parse("pdi");
const file = (path: string, mode = "100644") => ({ path, mode });

describe("checkMirrorScope", () => {
  it("accepts the files a pull writes: metadata, operational inventory and pull state", () => {
    expect(() =>
      checkMirrorScope(PDI, [
        file("instances/pdi/metadata/global/sys_script/rule--1.yaml"),
        file("instances/pdi/operational/global/sys_user_group.yaml"),
        file("instances/pdi/pull/state.yaml"),
        file("instances/pdi/pull/catalog.yaml"),
        // A pull removing a record.
        file("instances/pdi/metadata/global/sys_script/gone--2.yaml", "000000"),
      ]),
    ).not.toThrow();
  });

  it("refuses files outside the instance's mirrored folders and names them", () => {
    const entries = [
      file("instances/pdi/metadata/a.yaml"),
      file(".claude/settings.json"),
      file("AGENTS.md", "000000"),
      file("instances/pdi/instance.yaml"),
      file("instances/other/metadata/b.yaml"),
      file("instances/pdi/metadata-extra/c.yaml"),
    ];
    let error: unknown;
    try {
      checkMirrorScope(PDI, entries);
    } catch (caught) {
      error = caught;
    }
    if (!(error instanceof MirrorScopeError)) throw new Error("expected a MirrorScopeError");
    const scope = error;
    expect(scope.code).toBe("mirror-outside-scope");
    expect(scope.paths).toEqual([
      ".claude/settings.json",
      "AGENTS.md",
      "instances/pdi/instance.yaml",
      "instances/other/metadata/b.yaml",
      "instances/pdi/metadata-extra/c.yaml",
    ]);
    expect(scope.message).toContain(".claude/settings.json");
  });

  it("refuses links and submodules even inside the mirrored folders", () => {
    expect(() =>
      checkMirrorScope(PDI, [
        file("instances/pdi/metadata/link.yaml", "120000"),
        file("instances/pdi/metadata/module", "160000"),
        file("instances/pdi/metadata/run.sh", "100755"),
      ]),
    ).toThrow(MirrorScopeError);
  });
});
