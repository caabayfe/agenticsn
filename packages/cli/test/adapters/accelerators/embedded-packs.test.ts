import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  collectPacks,
  EmbeddedPackSource,
} from "../../../src/adapters/accelerators/embedded-pack-source";
import {
  EMBEDDED_PACKS_ENTRY,
  LazyPackSource,
  loadEmbeddedPacks,
  loadPackSource,
} from "../../../src/adapters/accelerators/pack-source-loader";

const FIXTURES = join(import.meta.dir, "../../../../../tests/fixtures/accelerators");

describe("packs in the binary (spec 005, 4.2)", () => {
  it("collects every pack under the roots into one record the build embeds, read back as from disk", async () => {
    const packs = await collectPacks([FIXTURES, join(FIXTURES, "absent")]);
    expect(Object.keys(packs)).toEqual(["minimal"]);
    const source = new EmbeddedPackSource(packs);
    expect(await source.ids()).toEqual(["minimal"]);
    expect(await source.manifest("minimal")).toMatchObject({ id: "minimal", version: "1.0.0" });
    expect([...(await source.files("minimal")).keys()]).toContain("accelerator.yaml");
    expect(await source.manifest("nope")).toBeNull();
    expect(await source.files("nope")).toEqual(new Map());
  });

  it("loads the embedded packs from the binary's own entry point", async () => {
    const requested: string[] = [];
    const source = await loadEmbeddedPacks(async (specifier) => {
      requested.push(specifier);
      return { packs: { minimal: { "accelerator.yaml": "id: minimal\n" } } };
    });
    expect(requested).toEqual([`./${EMBEDDED_PACKS_ENTRY}.js`]);
    expect(await source.ids()).toEqual(["minimal"]);
    await expect(loadEmbeddedPacks(async () => ({}))).rejects.toThrow(
      "the embedded accelerator packs are incomplete",
    );
  });

  it("loads the pack source once, on first use", async () => {
    let loads = 0;
    const lazy = new LazyPackSource(async () => {
      loads += 1;
      return new EmbeddedPackSource({ minimal: { "accelerator.yaml": "id: minimal\n" } });
    });
    expect(loads).toBe(0);
    expect(await lazy.ids()).toEqual(["minimal"]);
    expect(await lazy.manifest("minimal")).toEqual({ id: "minimal" });
    expect((await lazy.files("minimal")).size).toBe(1);
    expect(loads).toBe(1);
  });

  it("reads the configured pack folders from the repository when run from source", async () => {
    // No pack ships yet: the minimal test pack lives in tests/fixtures.
    expect(await (await loadPackSource()).ids()).toEqual([]);
  });
});
