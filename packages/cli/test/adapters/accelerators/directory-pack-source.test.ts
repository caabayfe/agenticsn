import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { DirectoryPackSource } from "../../../src/adapters/accelerators/directory-pack-source";

const FIXTURES = resolve(import.meta.dir, "../../../../../tests/fixtures/accelerators");

describe("directory pack source", () => {
  it("finds packs as directories with an accelerator.yaml, and reads every file by pack path", async () => {
    const packs = new DirectoryPackSource([resolve(FIXTURES, "missing"), FIXTURES]);
    expect(await packs.ids()).toEqual(["minimal"]);
    const files = await packs.files("minimal");
    expect([...files.keys()]).toContain("accelerator.yaml");
    expect([...files.keys()]).toContain("modules/base/module.yaml");
    expect([...files.keys()]).toContain("modules/base/data/demo/location.csv");
    expect(packs.parse(files.get("accelerator.yaml") ?? "")).toMatchObject({
      id: "minimal",
      profiles: { core: ["base"] },
    });
    expect(await packs.files("itsm")).toEqual(new Map());
  });
});
