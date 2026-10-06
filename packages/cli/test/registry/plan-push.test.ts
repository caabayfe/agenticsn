import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { InstanceName, recordHash } from "@snagentic/core";
import { GitDeliveryWorkspace } from "../../src/adapters/delivery/git-delivery-workspace";
import { runGitOrThrow } from "../../src/adapters/git/run-git";
import { toYaml } from "../../src/adapters/yaml/own-style";
import { executeUseCase } from "../../src/registry/execute";
import { planPush } from "../../src/registry/plan-push";
import { instanceWorkspace } from "../support/instance-workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const META = "instances/pdi/metadata";
const SYS_ID = "0123456789abcdef0123456789abcdef";
const INCLUDE = `global/sys_script_include/util--${SYS_ID}`;
const git = (root: string, ...args: string[]) =>
  runGitOrThrow(["-c", "user.name=t", "-c", "user.email=t@t", ...args], root);

async function workspace() {
  const ws = await instanceWorkspace({ sys_update_set: [], sys_update_xml: [] });
  cleanups.push(ws.cleanup);
  const write = async (path: string, content: string) => {
    await mkdir(join(ws.root, META, path, ".."), { recursive: true });
    await writeFile(join(ws.root, META, path), content);
  };
  const fields = { name: "Util", description: "Helpers", script: "var Util = Class.create();" };
  await write(
    `${INCLUDE}.yaml`,
    toYaml({
      _meta: {
        sys_class_name: "sys_script_include",
        sys_id: SYS_ID,
        scope: "global",
        hash: recordHash("sys_script_include", fields),
      },
      name: "Util",
      description: "Helpers",
    }),
  );
  await write(`${INCLUDE}.script.js`, "var Util = Class.create();\n");
  await write(`${INCLUDE}.children.sys_x.yaml`, "rows: []\n");
  await git(ws.root, "add", "instances");
  await git(ws.root, "commit", "-qm", "pull");
  await git(ws.root, "branch", "servicenow-remote/pdi");
  return { ...ws, write };
}

describe("plan-push", () => {
  it("plans the edited fields against the mirror, ready to push, without writing", async () => {
    const { context, write, instance } = await workspace();
    await write(`${INCLUDE}.script.js`, "var Util = Class.create();\nUtil.prototype = {};\n");
    const { output, exitCode } = await executeUseCase(planPush, {}, context);
    expect(output).toMatchObject({
      instance: "pdi",
      changes: [{ operation: "update", table: "sys_script_include", fields: ["script"] }],
      problems: [],
      gate: { passed: true },
      ready: true,
    });
    expect(exitCode).toBe(0);
    expect(instance.queries.some((q) => q.table === "sys_update_xml")).toBe(true);
    expect(planPush.render(output as never, "text")).toContain(
      "ready: snagentic push --instance pdi --plan",
    );
  });

  it("says when there is nothing to push, and exits 1 when the plan is not ready", async () => {
    const { context, write } = await workspace();
    const quiet = await executeUseCase(planPush, {}, context);
    expect(planPush.render(quiet.output as never, "text")).toContain("nothing to push");
    await write(`${INCLUDE}.script.js`, "eval(x);\n");
    await write(`${INCLUDE}.children.sys_x.yaml`, "rows: [1]\n");
    const { output, exitCode } = await executeUseCase(planPush, {}, context);
    expect(exitCode).toBe(1);
    const text = planPush.render(output as never, "text");
    expect(text).toContain("problem: ");
    expect(text).toContain("blocked: SN-SEC-001");
    expect(text).toContain("not ready");
  });
});

describe("GitDeliveryWorkspace", () => {
  it("reads records now and at the mirror commit, lists changes, the branch and waivers", async () => {
    const { root, write } = await workspace();
    const delivery = new GitDeliveryWorkspace(root, InstanceName.parse("pdi"));
    const commit = (await delivery.mirrorCommit()) ?? "";
    expect(await delivery.includes(commit)).toBe(true);
    expect(await delivery.branch()).toBe("main");
    await write("global/sys_script/new--ffffffffffffffffffffffffffffffff.yaml", "name: x\n");
    expect(await delivery.changedFiles(commit)).toEqual([
      "global/sys_script/new--ffffffffffffffffffffffffffffffff.yaml",
    ]);
    expect((await delivery.read(INCLUDE, commit))?.files).toEqual([
      { field: "script", content: "var Util = Class.create();\n" },
    ]);
    expect(
      await delivery.read("global/sys_script/new--ffffffffffffffffffffffffffffffff", commit),
    ).toBeNull();
    expect(await delivery.waivers()).toBeNull();
    await writeFile(join(root, "waivers.yaml"), "waivers: []\n");
    expect(await delivery.waivers()).toEqual({ waivers: [] });
    await git(root, "checkout", "-q", "--detach");
    expect(await delivery.branch()).toMatch(/^[0-9a-f]{7,}$/);
    await rm(join(root, META, "global"), { recursive: true });
    expect(await delivery.read(INCLUDE, null)).toBeNull();
  });

  it("knows when nothing was pulled yet", async () => {
    const { root } = await workspace();
    await git(root, "branch", "-D", "servicenow-remote/pdi");
    expect(
      await new GitDeliveryWorkspace(root, InstanceName.parse("pdi")).mirrorCommit(),
    ).toBeNull();
  });
});

describe("plan-push rendering", () => {
  it("shows waived findings, waiver problems and records held elsewhere", () => {
    const text = planPush.render(
      {
        instance: "pdi",
        planId: "0123456789abcdef",
        mirrorCommit: "c",
        label: "b",
        updateSets: [],
        changes: [
          {
            operation: "update",
            table: "t",
            sysId: "s",
            scope: "global",
            path: "p.yaml",
            fields: ["a"],
          },
        ],
        problems: [],
        gate: {
          passed: true,
          blocking: [],
          waived: [
            {
              ruleId: "SN-SEC-001",
              severity: "block",
              path: "p.js",
              line: 1,
              message: "m",
              reason: "ok",
              approver: "lead",
            },
          ],
          warnings: 0,
          waiverProblems: [{ index: 1, reason: "expired on 2026-01-01" }],
        },
        collisions: [
          {
            path: "p.yaml",
            record: "t_s",
            heldBy: [{ updateSet: "u", updateSetName: "Pat's work", updatedBy: "pat" }],
          },
        ],
        ready: false,
        next: [],
      },
      "text",
    );
    expect(text).toContain("waived:  SN-SEC-001 p.js (lead: ok)");
    expect(text).toContain("waivers.yaml entry 2: expired on 2026-01-01");
    expect(text).toContain(`held:    p.yaml in "Pat's work" (pat)`);
    expect(text).toContain("update sets: none");
  });
});
