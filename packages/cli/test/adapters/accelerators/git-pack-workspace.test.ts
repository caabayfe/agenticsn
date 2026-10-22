import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MaterializedFile } from "@snagentic/core";
import { GitPackWorkspace } from "../../../src/adapters/accelerators/git-pack-workspace";
import { runGitOrThrow } from "../../../src/adapters/git/run-git";

const APP = "source/x_min/src/fluent/app.now.ts";
const PROPERTY = "source/x_min/src/fluent/properties.now.ts";
const CONFIG = "source/x_min/now.config.json";

const git = (root: string, ...args: string[]) => runGitOrThrow(args, root);

// A workspace whose main branch has integrated the mirror of instance pdi.
async function workspace() {
  const root = mkdtempSync(join(tmpdir(), "pack-workspace-"));
  await git(root, "init", "-q", "-b", "main");
  await git(root, "config", "user.name", "t");
  await git(root, "config", "user.email", "t@t");
  mkdirSync(join(root, "instances/pdi/metadata/global"), { recursive: true });
  writeFileSync(join(root, "instances/pdi/metadata/global/p--a1.yaml"), "name: p\n");
  await git(root, "add", ".");
  await git(root, "commit", "-q", "-m", "pull");
  await git(root, "branch", "servicenow-remote/pdi");
  return { root, packs: new GitPackWorkspace(root, "pdi") };
}

const file = (path: string, text: string): MaterializedFile => ({ path, text, capability: "base" });
const files = (value: string): MaterializedFile[] => [
  file(CONFIG, '{ "scope": "x_min" }\n'),
  file(APP, `Record({ value: '${value}' })\n`),
];
const read = (root: string, path: string) => readFileSync(join(root, path), "utf8");

describe("git pack workspace (ADR-0026, ADR-0031)", () => {
  it("knows the mirror commit and that main integrated it", async () => {
    const { packs } = await workspace();
    const mirror = await packs.mirrorCommit();
    expect(mirror).toMatch(/^[0-9a-f]{40}$/);
    expect(await packs.includes(mirror ?? "")).toBe(true);
  });

  it("commits the pack's source on the mirror with plumbing, then merges it at its workspace paths", async () => {
    const { root, packs } = await workspace();
    const mirror = (await packs.mirrorCommit()) ?? "";
    const status = await git(root, "status", "--porcelain");
    const commit = await packs.commit("minimal", mirror, files("a"), "add minimal 1.0.0", []);
    // The working tree is untouched until the merge.
    expect(await git(root, "status", "--porcelain")).toBe(status);
    expect(await git(root, "rev-parse", "accelerator/minimal/pdi")).toBe(`${commit}\n`);
    expect(await packs.merge("minimal")).toEqual({
      branch: "accelerator/minimal/pdi",
      conflicts: [],
    });
    expect(read(root, APP)).toBe("Record({ value: 'a' })\n");
    expect(read(root, CONFIG)).toBe('{ "scope": "x_min" }\n');
    expect(read(root, "instances/pdi/metadata/global/p--a1.yaml")).toBe("name: p\n");
  });

  it("changes nothing when the same version is added again", async () => {
    const { root, packs } = await workspace();
    const mirror = (await packs.mirrorCommit()) ?? "";
    const first = await packs.commit("minimal", mirror, files("a"), "add", []);
    await packs.merge("minimal");
    const head = await git(root, "rev-parse", "HEAD");
    expect(await packs.commit("minimal", mirror, files("a"), "add again", [])).toBe(first);
    expect(await packs.merge("minimal")).toEqual({
      branch: "accelerator/minimal/pdi",
      conflicts: [],
    });
    expect(await git(root, "rev-parse", "HEAD")).toBe(head);
  });

  it("leaves a conflict for the user when a new version changes a line they edited", async () => {
    const { root, packs } = await workspace();
    const mirror = (await packs.mirrorCommit()) ?? "";
    await packs.commit("minimal", mirror, files("a"), "1.0.0", []);
    await packs.merge("minimal");
    writeFileSync(join(root, APP), "Record({ value: 'ours' })\n");
    await git(root, "commit", "-qam", "the user's own value");
    await packs.commit("minimal", mirror, files("b"), "1.0.1", []);
    expect(await packs.merge("minimal")).toEqual({
      branch: "accelerator/minimal/pdi",
      conflicts: [APP],
    });
  });

  it("remembers what each add wrote, and keeps a dropped file as the last add wrote it (M8)", async () => {
    const { root, packs } = await workspace();
    const mirror = (await packs.mirrorCommit()) ?? "";
    expect(await packs.previous("minimal")).toEqual({ written: [], kept: [] });
    const property = (value: string) => file(PROPERTY, `Record({ on: ${value} })\n`);
    await packs.commit("minimal", mirror, [...files("a"), property("true")], "1.0.0", []);
    await packs.merge("minimal");
    expect(await packs.previous("minimal")).toEqual({ written: [CONFIG, APP, PROPERTY], kept: [] });
    // 1.0.1 changes the property and drops the application file.
    const next = [file(CONFIG, '{ "scope": "x_min" }\n'), property("false")];
    await packs.commit("minimal", mirror, next, "1.0.1", [APP]);
    expect(await packs.merge("minimal")).toEqual({
      branch: "accelerator/minimal/pdi",
      conflicts: [],
    });
    expect(read(root, APP)).toBe("Record({ value: 'a' })\n");
    expect(read(root, PROPERTY)).toBe("Record({ on: false })\n");
    expect(await packs.previous("minimal")).toEqual({ written: [CONFIG, PROPERTY], kept: [APP] });
  });

  it("reports a merge that fails for another reason", async () => {
    const { packs } = await workspace();
    await expect(packs.merge("never-added")).rejects.toThrow(
      "git merge accelerator/never-added/pdi failed",
    );
  });

  it("names which paths the working branch holds", async () => {
    const { root, packs } = await workspace();
    const mirror = (await packs.mirrorCommit()) ?? "";
    await packs.commit("minimal", mirror, files("1"), "add", []);
    await packs.merge("minimal");
    expect(await packs.present([APP, PROPERTY])).toEqual([APP]);
    expect(await packs.present([])).toEqual([]);
    expect(read(root, APP)).toContain("'1'");
  });

  it("reads the committed reports of the pack's installs on this instance only", async () => {
    const { root, packs } = await workspace();
    const report = (path: string, text: string) => {
      mkdirSync(join(root, path, ".."), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    report("accelerators/installs/pdi/itsm-1b594e036513a172/report.md", "itsm on pdi");
    report("accelerators/installs/pdi/itsm-1b594e036513a172/plan.md", "a plan");
    report("accelerators/installs/pdi/itsm-extra-0bf2d5af60c6bb0e/report.md", "another pack");
    report("accelerators/installs/pdi2/itsm-76f7e1dc53dc27d5/report.md", "another instance");
    await git(root, "add", ".");
    await git(root, "commit", "-q", "-m", "installs");
    report("accelerators/installs/pdi/itsm-c005571e3a6fed3c/report.md", "not committed");
    expect(await packs.installReports("itsm")).toEqual(["itsm on pdi"]);
  });

  it("parses an adopt file as YAML", async () => {
    const { packs } = await workspace();
    expect(packs.parse("- table: incident\n  sys_id: x\n")).toEqual([
      { table: "incident", sys_id: "x" },
    ]);
  });
});
