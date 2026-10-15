import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

// NTT DATA's packs must be able to move to a private repository as a whole (spec 005, P2 and
// 4.2): only the build configuration's pack list names the folder, and nothing in it reaches
// outside it.
const ROOT = join(import.meta.dir, "../..");
const CONFIGURATION = "packages/cli/src/adapters/accelerators/pack-roots.ts";
const tracked = async () =>
  (await $`git ls-files`.cwd(ROOT).text()).split("\n").filter((p) => p !== "");

describe("the nttdata folder stays movable", () => {
  it("is named by no code outside it but the build configuration's pack list", async () => {
    const code = (await tracked()).filter(
      (p) => /\.(ts|js|json)$/.test(p) && !p.startsWith("nttdata/") && !p.startsWith("tests/"),
    );
    const naming = code.filter(
      (p) => p !== CONFIGURATION && readFileSync(join(ROOT, p), "utf8").includes("nttdata/"),
    );
    expect(naming).toEqual([]);
    expect(readFileSync(join(ROOT, CONFIGURATION), "utf8")).toContain('"nttdata/accelerators"');
  });

  it("references no path outside itself", async () => {
    const inside = (await tracked()).filter((p) => p.startsWith("nttdata/"));
    const escaping = inside.filter((p) => readFileSync(join(ROOT, p), "utf8").includes("../"));
    expect(escaping).toEqual([]);
  });
});
