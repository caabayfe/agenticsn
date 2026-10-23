import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STANDALONE } from "../../scripts/standalone";

// The release binary runs in workspaces that a repository or an agent can fill. Bun's compiled
// binaries read bunfig.toml (preload scripts) and .env from the working directory unless told
// not to, which would run a workspace's code inside the binary the keychain trusts.
const dir = mkdtempSync(join(tmpdir(), "snagentic-standalone-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the compiled binary (spec 012, B-02)", () => {
  it("reads no bunfig.toml or .env from the directory it runs in", async () => {
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, 'console.log(`main ${process.env["FROM_DOTENV"] ?? "clean"}`);\n');
    const outfile = join(dir, "probe");
    const built = await Bun.build({ entrypoints: [entry], compile: { outfile, ...STANDALONE } });
    expect(built.success).toBe(true);

    const workspace = mkdtempSync(join(dir, "workspace-"));
    writeFileSync(join(workspace, "bunfig.toml"), 'preload = ["./planted.ts"]\n');
    writeFileSync(join(workspace, "planted.ts"), 'console.log("planted code ran");\n');
    writeFileSync(join(workspace, ".env"), "FROM_DOTENV=loaded\n");
    const run = Bun.spawnSync([outfile], { cwd: workspace, env: { PATH: process.env["PATH"] } });

    expect(run.stdout.toString().trim()).toBe("main clean");
  }, 60_000);
});
