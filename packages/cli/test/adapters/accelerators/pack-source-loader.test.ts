import { afterEach, describe, expect, it } from "bun:test";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EmbeddedPackSource } from "../../../src/adapters/accelerators/embedded-pack-source";
import {
  LayeredPackSource,
  loadPackSource,
  workspacePackRoots,
} from "../../../src/adapters/accelerators/pack-source-loader";

const FIXTURES = resolve(import.meta.dir, "../../../../../tests/fixtures/accelerators");

const made: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pack-paths-"));
  made.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("workspace pack paths (ADR-0038, item 7)", () => {
  it("reads accelerators.paths from the nearest snagentic.yaml, resolved from its directory", async () => {
    const root = await scratch();
    const workspace = join(root, "workspace");
    await mkdir(join(workspace, "source", "x_app"), { recursive: true });
    await writeFile(
      join(workspace, "snagentic.yaml"),
      "layout: 2\naccelerators:\n  paths: [../packs, /opt/packs, ./local]\n",
    );
    // A workspace further up does not count: the nearest manifest wins.
    await writeFile(join(root, "snagentic.yaml"), "accelerators:\n  paths: [elsewhere]\n");
    expect(await workspacePackRoots(join(workspace, "source", "x_app"))).toEqual([
      join(root, "packs"),
      "/opt/packs",
      join(workspace, "local"),
    ]);
  });

  it("has no pack paths in a workspace that names none, or outside a workspace", async () => {
    const workspace = await scratch();
    await writeFile(join(workspace, "snagentic.yaml"), "layout: 2\n");
    expect(await workspacePackRoots(workspace)).toEqual([]);
    expect(await workspacePackRoots(await scratch())).toEqual([]);
  });

  it("loads the packs under a workspace's pack paths alongside those snagentic ships", async () => {
    const workspace = await scratch();
    await cp(join(FIXTURES, "minimal"), join(workspace, "packs", "minimal"), { recursive: true });
    await writeFile(join(workspace, "snagentic.yaml"), "accelerators:\n  paths: [packs]\n");
    const packs = await loadPackSource(workspace);
    expect(await packs.ids()).toEqual(["minimal"]);
    expect([...(await packs.files("minimal")).keys()]).toContain("modules/base/module.yaml");
  });
});

describe("layered pack source", () => {
  const pack = (version: string) => ({ "accelerator.yaml": `id: minimal\nversion: ${version}\n` });

  it("lists every source's packs once, and an earlier source hides the same pack in a later one", async () => {
    const layered = new LayeredPackSource([
      new EmbeddedPackSource({ minimal: pack("2.0.0") }),
      new EmbeddedPackSource({
        minimal: pack("1.0.0"),
        itsm: { "accelerator.yaml": "id: itsm\n" },
      }),
    ]);
    expect(await layered.ids()).toEqual(["itsm", "minimal"]);
    const files = await layered.files("minimal");
    expect(layered.parse(files.get("accelerator.yaml") ?? "")).toEqual({
      id: "minimal",
      version: "2.0.0",
    });
    expect([...(await layered.files("itsm")).keys()]).toEqual(["accelerator.yaml"]);
    expect(await layered.files("nope")).toEqual(new Map());
  });
});
