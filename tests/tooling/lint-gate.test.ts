import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

async function json(path: string): Promise<Record<string, unknown>> {
  return Bun.file(join(ROOT, path)).json();
}

describe("lint gate", () => {
  it("fails lint on Biome warnings, so unused imports can't pass verify", async () => {
    const scripts = (await json("package.json"))["scripts"];
    expect(scripts).toMatchObject({ lint: expect.stringContaining("--error-on-warnings") });
  });

  it("keeps biome.json on the installed Biome's schema (run biome migrate after an upgrade)", async () => {
    const installed = (await json("node_modules/@biomejs/biome/package.json"))["version"];
    const schema = (await json("biome.json"))["$schema"];
    expect(schema).toBe(`https://biomejs.dev/schemas/${String(installed)}/schema.json`);
  });
});
