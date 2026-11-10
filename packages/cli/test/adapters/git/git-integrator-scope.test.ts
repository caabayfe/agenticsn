import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  artifactFromRow,
  Catalog,
  DEFAULT_REDACTION,
  InstanceName,
  renderRecord,
} from "@snagentic/core";
import { gitIntegrator } from "../../../src/adapters/git/git-integrator";
import { GitMirror } from "../../../src/adapters/git/git-mirror";
import { runGit, runGitOrThrow } from "../../../src/adapters/git/run-git";
import { FsWorkspaceStore } from "../../../src/adapters/workspace/fs-workspace-store";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const PDI = InstanceName.parse("pdi");
const catalog = new Catalog({
  parents: { sys_metadata: null, sys_script: "sys_metadata" },
  scopes: {},
  typedFields: { sys_script: { script: "script_server" } },
});
const SCRIPT_PATH =
  "instances/pdi/metadata/global/sys_script/rule--00000000000000000000000000000001.script.js";

const git = (root: string, ...args: string[]) =>
  runGitOrThrow(["-c", "user.name=t", "-c", "user.email=t@t", ...args], root);

async function workspace(): Promise<{ base: string; root: string }> {
  const base = await mkdtemp(join(tmpdir(), "snagentic-integrate-scope-"));
  temporary.push(base);
  const root = join(base, "w");
  await new FsWorkspaceStore().create(root, { layout: 2, createdWith: "test" });
  return { base, root };
}

async function pullScript(root: string, script: string): Promise<void> {
  const mirror = await GitMirror.open(root, PDI, "fresh");
  const row = {
    sys_id: "00000000000000000000000000000001",
    sys_class_name: "sys_script",
    name: "Rule",
    script,
  };
  await mirror.write(
    "instances/pdi/metadata",
    renderRecord(artifactFromRow(row, catalog, DEFAULT_REDACTION), catalog),
  );
  await mirror.finish("pull");
}

// A commit on servicenow-remote/pdi that a pull never made: `change` edits a checkout of it.
async function pushToMirror(
  base: string,
  root: string,
  change: (checkout: string) => Promise<void>,
): Promise<void> {
  const checkout = join(base, `mirror-${temporary.length}-${Date.now()}`);
  await git(root, "worktree", "add", "-q", checkout, "servicenow-remote/pdi");
  await change(checkout);
  await git(checkout, "add", "-A");
  await git(checkout, "commit", "-q", "-m", "pull");
  await git(root, "worktree", "remove", "--force", checkout);
}

async function put(checkout: string, path: string, text: string): Promise<void> {
  await mkdir(dirname(join(checkout, path)), { recursive: true });
  await writeFile(join(checkout, path), text);
}

async function snapshot(root: string) {
  return {
    head: (await git(root, "rev-parse", "HEAD")).trim(),
    status: await git(root, "status", "--porcelain"),
    merging: (await runGit(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], root)).exitCode,
  };
}

describe("GitIntegrator mirror scope", () => {
  it("refuses a mirror commit that adds agent settings, merging nothing", async () => {
    const { base, root } = await workspace();
    await pullScript(root, "one();");
    await gitIntegrator.integrate(root, "pdi");
    await pullScript(root, "two();");
    await pushToMirror(base, root, (checkout) =>
      put(checkout, ".claude/settings.json", '{"hooks":{}}\n'),
    );
    const before = await snapshot(root);
    const error = await gitIntegrator.integrate(root, "pdi").catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "mirror-outside-scope" });
    expect(String(error)).toContain(".claude/settings.json");
    expect(await snapshot(root)).toEqual(before);
    expect(await Bun.file(join(root, ".claude/settings.json")).exists()).toBe(false);
    expect(await readFile(join(root, SCRIPT_PATH), "utf8")).toBe("one();\n");
  });

  it("refuses a first integrate of a mirror holding files outside the instance's folders", async () => {
    const { base, root } = await workspace();
    await pullScript(root, "one();");
    await pushToMirror(base, root, (checkout) => put(checkout, "AGENTS.md", "instructions\n"));
    const before = await snapshot(root);
    await expect(gitIntegrator.integrate(root, "pdi")).rejects.toMatchObject({
      code: "mirror-outside-scope",
    });
    expect(await snapshot(root)).toEqual(before);
  });

  it("refuses a mirror commit that removes a file of the developer's branch", async () => {
    const { base, root } = await workspace();
    await pullScript(root, "one();");
    await gitIntegrator.integrate(root, "pdi");
    // A mirror branch rebuilt on the developer's branch, dropping one of its files.
    await git(root, "branch", "-f", "servicenow-remote/pdi", "HEAD");
    await pushToMirror(base, root, (checkout) => rm(join(checkout, ".gitignore")));
    await expect(gitIntegrator.integrate(root, "pdi")).rejects.toMatchObject({
      code: "mirror-outside-scope",
    });
    expect(await Bun.file(join(root, ".gitignore")).exists()).toBe(true);
  });

  it("refuses a link inside the instance's metadata folder", async () => {
    const { base, root } = await workspace();
    await pullScript(root, "one();");
    await gitIntegrator.integrate(root, "pdi");
    await pushToMirror(base, root, async (checkout) => {
      const link = join(checkout, "instances/pdi/metadata/global/link.yaml");
      await symlink("../../../../AGENTS.md", link);
    });
    const before = await snapshot(root);
    const error = await gitIntegrator.integrate(root, "pdi").catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "mirror-outside-scope" });
    expect(String(error)).toContain("instances/pdi/metadata/global/link.yaml");
    expect(await snapshot(root)).toEqual(before);
  });

  it("integrates a mirror commit that changes only the instance's folders", async () => {
    const { base, root } = await workspace();
    await pullScript(root, "one();");
    await gitIntegrator.integrate(root, "pdi");
    await pullScript(root, "two();");
    await pushToMirror(base, root, (checkout) =>
      put(checkout, "instances/pdi/pull/state.yaml", "watermark: x\n"),
    );
    const result = await gitIntegrator.integrate(root, "pdi");
    expect(result.commit).not.toBeNull();
    expect(await readFile(join(root, SCRIPT_PATH), "utf8")).toBe("two();\n");
  });
});
