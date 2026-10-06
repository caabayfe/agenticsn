import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  artifactFromRow,
  Catalog,
  DEFAULT_REDACTION,
  InstanceName,
  renderRecord,
} from "@snagentic/core";
import { gitInspector } from "../../../src/adapters/git/git-inspector";
import { gitIntegrator } from "../../../src/adapters/git/git-integrator";
import { GitMirror } from "../../../src/adapters/git/git-mirror";
import { runGitOrThrow } from "../../../src/adapters/git/run-git";
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
const SCRIPT =
  "instances/pdi/metadata/global/sys_script/rule--00000000000000000000000000000001.script.js";

async function workspace(): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "snagentic-inspect-"));
  temporary.push(base);
  const root = join(base, "w");
  await new FsWorkspaceStore().create(root, { layout: 1, createdWith: "test" });
  return root;
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

describe("gitInspector", () => {
  it("sees nothing before the first pull", async () => {
    expect(await gitInspector.inspect(await workspace(), "pdi")).toEqual({
      remoteCommit: null,
      unintegratedPulls: 0,
      localChanges: [],
    });
  });

  it("counts pulls not yet integrated", async () => {
    const root = await workspace();
    await pullScript(root, "one();");
    const view = await gitInspector.inspect(root, "pdi");
    expect(view.unintegratedPulls).toBe(1);
    expect(view.remoteCommit).toMatch(/^[0-9a-f]{40}$/);
    await gitIntegrator.integrate(root, "pdi");
    expect((await gitInspector.inspect(root, "pdi")).unintegratedPulls).toBe(0);
  });

  it("lists local edits and new files, committed or not, but not changes waiting on the remote", async () => {
    const root = await workspace();
    await pullScript(root, "one();");
    await gitIntegrator.integrate(root, "pdi");
    await writeFile(join(root, SCRIPT), "edited();\n");
    const added = "instances/pdi/metadata/global/sys_script/new.yaml";
    await writeFile(join(root, added), "name: new\n");
    await pullScript(root, "remote();");
    const view = await gitInspector.inspect(root, "pdi");
    expect(view.localChanges).toEqual([added, SCRIPT]);
    expect(view.unintegratedPulls).toBe(1);
    await runGitOrThrow(
      ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "edit"],
      root,
    );
    expect((await gitInspector.inspect(root, "pdi")).localChanges).toContain(SCRIPT);
  });

  it("ignores files outside the synced folders, such as the instance profile", async () => {
    const root = await workspace();
    await pullScript(root, "one();");
    await gitIntegrator.integrate(root, "pdi");
    await writeFile(join(root, "instances/pdi/instance.yaml"), "kind: development\n");
    expect((await gitInspector.inspect(root, "pdi")).localChanges).toEqual([]);
  });
});
