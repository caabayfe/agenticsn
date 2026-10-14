import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MaterializedFile } from "@snagentic/core";
import { GitPackWorkspace } from "../../../src/adapters/accelerators/git-pack-workspace";
import { runGitOrThrow } from "../../../src/adapters/git/run-git";

const SLA = "3d5fd9f1c0a8016400cbc76ea0b4c9a4";
const METADATA = "instances/pdi/metadata";
const SLA_PATH = `global/contract_sla/p1--${SLA}.yaml`;

const git = (root: string, ...args: string[]) => runGitOrThrow(args, root);

// A workspace whose main branch has integrated the mirror of instance pdi.
async function workspace() {
  const root = mkdtempSync(join(tmpdir(), "pack-workspace-"));
  await git(root, "init", "-q", "-b", "main");
  await git(root, "config", "user.name", "t");
  await git(root, "config", "user.email", "t@t");
  mkdirSync(join(root, METADATA, "global/contract_sla"), { recursive: true });
  writeFileSync(
    join(root, METADATA, SLA_PATH),
    `_meta:\n  sys_id: ${SLA}\nname: P1\nduration: 8h\n`,
  );
  await git(root, "add", ".");
  await git(root, "commit", "-q", "-m", "pull");
  await git(root, "branch", "servicenow-remote/pdi");
  return { root, packs: new GitPackWorkspace(root, "pdi") };
}

const files = (duration: string): MaterializedFile[] => [
  { kind: "copy", path: "x_min/sys_app/min--a1.yaml", text: "name: min\n", capability: "base" },
  {
    kind: "patch",
    path: SLA_PATH,
    document: { _meta: { sys_id: SLA }, name: "P1", duration },
    fields: ["duration"],
  },
];

describe("git pack workspace (ADR-0026)", () => {
  it("knows the mirror commit, that main integrated it, and finds a mirrored record by sys_id", async () => {
    const { packs } = await workspace();
    const mirror = await packs.mirrorCommit();
    expect(mirror).toMatch(/^[0-9a-f]{40}$/);
    expect(await packs.includes(mirror ?? "")).toBe(true);
    const found = await packs.mirrored(mirror ?? "", [SLA, "f".repeat(32)]);
    expect([...found.keys()]).toEqual([SLA]);
    expect(found.get(SLA)).toEqual({
      path: SLA_PATH,
      document: { _meta: { sys_id: SLA }, name: "P1", duration: "8h" },
    });
    expect(await packs.mirrored(mirror ?? "", [])).toEqual(new Map());
  });

  it("commits the pack on the mirror with plumbing, then merges it into the working branch", async () => {
    const { root, packs } = await workspace();
    const mirror = (await packs.mirrorCommit()) ?? "";
    const status = await git(root, "status", "--porcelain");
    const commit = await packs.commit("minimal", mirror, files("4h"), "add minimal 1.0.0");
    // The working tree is untouched until the merge.
    expect(await git(root, "status", "--porcelain")).toBe(status);
    expect(await git(root, "rev-parse", "accelerator/minimal/pdi")).toBe(`${commit}\n`);
    expect(await packs.merge("minimal")).toEqual({
      branch: "accelerator/minimal/pdi",
      conflicts: [],
    });
    expect(readFileSync(join(root, METADATA, "x_min/sys_app/min--a1.yaml"), "utf8")).toBe(
      "name: min\n",
    );
    expect(readFileSync(join(root, METADATA, SLA_PATH), "utf8")).toContain("duration: 4h");
  });

  it("changes nothing when the same version is added again", async () => {
    const { root, packs } = await workspace();
    const mirror = (await packs.mirrorCommit()) ?? "";
    const first = await packs.commit("minimal", mirror, files("4h"), "add");
    await packs.merge("minimal");
    const head = await git(root, "rev-parse", "HEAD");
    expect(await packs.commit("minimal", mirror, files("4h"), "add again")).toBe(first);
    expect(await packs.merge("minimal")).toEqual({
      branch: "accelerator/minimal/pdi",
      conflicts: [],
    });
    expect(await git(root, "rev-parse", "HEAD")).toBe(head);
  });

  it("leaves a conflict for the user when a new version changes a field they edited", async () => {
    const { root, packs } = await workspace();
    const mirror = (await packs.mirrorCommit()) ?? "";
    await packs.commit("minimal", mirror, files("4h"), "1.0.0");
    await packs.merge("minimal");
    const path = join(root, METADATA, SLA_PATH);
    writeFileSync(path, readFileSync(path, "utf8").replace("duration: 4h", "duration: 6h"));
    await git(root, "commit", "-qam", "the user's own SLA");
    await packs.commit("minimal", mirror, files("2h"), "1.0.1");
    expect(await packs.merge("minimal")).toEqual({
      branch: "accelerator/minimal/pdi",
      conflicts: [`${METADATA}/${SLA_PATH}`],
    });
  });

  it("reports a merge that fails for another reason", async () => {
    const { packs } = await workspace();
    await expect(packs.merge("never-added")).rejects.toThrow(
      "git merge accelerator/never-added/pdi failed",
    );
  });

  it("parses a patch file as YAML", async () => {
    const { packs } = await workspace();
    expect(packs.parse("table: incident\nsys_id: x\n")).toEqual({ table: "incident", sys_id: "x" });
  });
});
