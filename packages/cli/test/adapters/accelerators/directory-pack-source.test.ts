import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { DirectoryPackSource } from "../../../src/adapters/accelerators/directory-pack-source";

const FIXTURES = resolve(import.meta.dir, "../../../../../tests/fixtures/accelerators");

describe("directory pack source", () => {
  it("finds packs as directories with an accelerator.yaml, and reads their manifest", async () => {
    const packs = new DirectoryPackSource([resolve(FIXTURES, "missing"), FIXTURES]);
    expect(await packs.ids()).toEqual(["minimal"]);
    expect(await packs.manifest("minimal")).toMatchObject({
      id: "minimal",
      scope: "x_snagentic_min",
    });
    expect(await packs.manifest("itsm")).toBeNull();
  });
});
