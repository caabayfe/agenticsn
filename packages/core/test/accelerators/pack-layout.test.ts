import { describe, expect, it } from "bun:test";
import { demoPath, isPackOnly, moduleOf, packDocument, workspacePathOf } from "@snagentic/core";

const parse = (text: string): unknown => JSON.parse(text);
const HEAD = { id: "minimal", version: "1.0.0", profiles: { core: ["base"] } };

describe("pack layout, format 2 (ADR-0038)", () => {
  it("assembles accelerator.yaml with each module.yaml under modules", () => {
    const files = new Map([
      ["accelerator.yaml", JSON.stringify(HEAD)],
      ["modules/base/module.yaml", JSON.stringify({ label: "base" })],
      ["modules/extra/module.yaml", JSON.stringify({ dependsOn: ["base"] })],
      ["modules/extra/source/global/now.config.json", "{}"],
      ["modules/extra/nested/module.yaml", JSON.stringify({ label: "not a module" })],
    ]);
    expect(packDocument(files, parse)).toEqual({
      document: {
        ...HEAD,
        modules: { base: { label: "base" }, extra: { dependsOn: ["base"] } },
      },
      problems: [],
    });
  });

  it("says when accelerator.yaml is missing", () => {
    expect(packDocument(new Map([["modules/base/module.yaml", "{}"]]), parse).problems).toEqual([
      "accelerator.yaml is missing",
    ]);
  });

  it("refuses format 1: capabilities in accelerator.yaml, or content under source/ adopt/ data/", () => {
    const capabilities = new Map([
      ["accelerator.yaml", JSON.stringify({ ...HEAD, capabilities: { base: {} } })],
    ]);
    const content = (path: string) =>
      new Map([
        ["accelerator.yaml", JSON.stringify(HEAD)],
        ["modules/base/module.yaml", "{}"],
        [path, "x"],
      ]);
    for (const files of [
      capabilities,
      content("source/base/global/now.config.json"),
      content("adopt/base.yaml"),
      content("data/location.csv"),
      content("metadata/base/x.yaml"),
      content("patches/base/x.yaml"),
    ]) {
      const { document, problems } = packDocument(files, parse);
      expect(document).toBeNull();
      expect(problems).toHaveLength(1);
      expect(problems[0]).toStartWith("pack format 1");
    }
  });

  it("places a module's files: source into the workspace, the rest pack-only", () => {
    expect(moduleOf("modules/base/source/global/a.now.ts")).toBe("base");
    expect(moduleOf("accelerator.yaml")).toBeNull();
    expect(moduleOf("modules/base")).toBeNull();
    expect(workspacePathOf("modules/base/source/x_app/src/a.now.ts")).toBe(
      "source/x_app/src/a.now.ts",
    );
    expect(workspacePathOf("modules/base/source/x_app")).toBeNull();
    expect(workspacePathOf("modules/base/adopt.yaml")).toBeNull();
    for (const path of [
      "accelerator.yaml",
      "README.md",
      "modules/base/README.md",
      "modules/base/module.yaml",
      "modules/base/data/demo/location.csv",
    ]) {
      expect(isPackOnly(path)).toBe(true);
    }
    expect(isPackOnly("modules/base/source/global/a.now.ts")).toBe(false);
    expect(demoPath("base", "location.csv")).toBe("modules/base/data/demo/location.csv");
  });
});
