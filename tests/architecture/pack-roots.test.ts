import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { PACK_ROOTS } from "../../packages/cli/src/adapters/accelerators/pack-roots";

// NTT DATA's accelerator packs live in their own repository, read from a workspace's pack paths
// (ADR-0038, item 7; decision D6): this repository ships only snagentic's own packs, and the
// build embeds nothing else.
const ROOT = join(import.meta.dir, "../..");
const tracked = async () =>
  (await $`git ls-files`.cwd(ROOT).text()).split("\n").filter((p) => p !== "");

describe("NTT DATA's packs stay out of this repository", () => {
  it("has no nttdata folder", async () => {
    expect(existsSync(join(ROOT, "nttdata"))).toBe(false);
    expect((await tracked()).filter((p) => p.startsWith("nttdata/"))).toEqual([]);
  });

  it("embeds only the packs under packages/accelerators", () => {
    expect([...PACK_ROOTS]).toEqual(["packages/accelerators"]);
    expect(PACK_ROOTS.some((root) => root.includes("nttdata"))).toBe(false);
  });
});
