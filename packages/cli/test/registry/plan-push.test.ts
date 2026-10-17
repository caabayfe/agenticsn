import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { InstanceName, recordHash } from "@snagentic/core";
import { GitDeliveryWorkspace } from "../../src/adapters/delivery/git-delivery-workspace";
import { runGitOrThrow } from "../../src/adapters/git/run-git";
import { toYaml } from "../../src/adapters/yaml/own-style";
import { executeUseCase } from "../../src/registry/execute";
import { planPush } from "../../src/registry/plan-push";
import { instanceWorkspace } from "../support/instance-workspace";
import { SI_UNIT, unitWorkspace } from "../support/unit-workspace";

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

describe("plan-push (ADR-0033)", () => {
  it("plans an edited unit against the instance's live copy, ready to push, without writing", async () => {
    const ws = await unitWorkspace({ source: "Edited in source.", instance: "" });
    cleanups.push(ws.cleanup);
    const { output, exitCode } = await executeUseCase(planPush, {}, ws.context);
    expect(output).toMatchObject({
      instance: "pdi",
      units: [
        { updateName: SI_UNIT, operation: "load", changes: ["sys_script_include.description"] },
      ],
      problems: [],
      gate: { passed: true },
      ready: true,
    });
    expect(exitCode).toBe(0);
    expect(ws.instance.writes).toEqual([]);
    expect(planPush.render(output as never, "text")).toContain(
      "ready: snagentic push --instance pdi --plan",
    );
  });

  it("says when there is nothing to push, and exits 1 when the plan is not ready", async () => {
    const same = await unitWorkspace({ source: "", instance: "" });
    cleanups.push(same.cleanup);
    const quiet = await executeUseCase(planPush, {}, same.context);
    expect(planPush.render(quiet.output as never, "text")).toContain("nothing to push");
    const drifted = await unitWorkspace({ source: "Edited in source.", instance: "Edited there." });
    cleanups.push(drifted.cleanup);
    drifted.tables["sys_script_include"] = (drifted.tables["sys_script_include"] ?? []).map(
      (row) => ({
        ...row,
        sys_mod_count: "2",
      }),
    );
    const { output, exitCode } = await executeUseCase(planPush, {}, drifted.context);
    expect(exitCode).toBe(1);
    const text = planPush.render(output as never, "text");
    expect(text).toContain(`problem: ${SI_UNIT}: changed on the instance`);
    expect(text).toContain("not ready");
  });
});

describe("GitDeliveryWorkspace", () => {
  it("names the mirror commit, the branch and the committed waivers", async () => {
    const { root } = await workspace();
    const delivery = new GitDeliveryWorkspace(root, InstanceName.parse("pdi"));
    expect(await delivery.mirrorCommit()).toMatch(/^[0-9a-f]{40}$/);
    expect(await delivery.branch()).toBe("main");
    expect(await delivery.waivers()).toEqual({ committed: null, uncommitted: false });
    await writeFile(join(root, "waivers.yaml"), "waivers: []\n");
    expect(await delivery.waivers()).toEqual({ committed: null, uncommitted: true });
    await git(root, "add", "waivers.yaml");
    await git(root, "commit", "-qm", "waive");
    expect(await delivery.waivers()).toEqual({ committed: { waivers: [] }, uncommitted: false });
    await writeFile(join(root, "waivers.yaml"), "waivers: [x]\n");
    expect(await delivery.waivers()).toEqual({ committed: { waivers: [] }, uncommitted: true });
    await git(root, "checkout", "-q", "--detach");
    expect(await delivery.branch()).toMatch(/^[0-9a-f]{7,}$/);
  });

  it("lists source not committed, and commits exactly the files it is given", async () => {
    const { root } = await workspace();
    const delivery = new GitDeliveryWorkspace(root, InstanceName.parse("pdi"));
    expect(await delivery.uncommittedSource()).toEqual([]);
    await mkdir(join(root, "source/x_app"), { recursive: true });
    await writeFile(join(root, "source/x_app/snagentic.ledger.yaml"), "pdi: {}\n");
    await writeFile(join(root, "source/x_app/other.now.ts"), "// draft\n");
    expect(await delivery.uncommittedSource()).toEqual([
      "source/x_app/other.now.ts",
      "source/x_app/snagentic.ledger.yaml",
    ]);
    const commit = await delivery.commitFiles(
      ["source/x_app/snagentic.ledger.yaml"],
      "chore: ledger",
    );
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    expect(await delivery.uncommittedSource()).toEqual(["source/x_app/other.now.ts"]);
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
  it("shows units, what they also set, waived findings, waiver problems and records held elsewhere", () => {
    const finding = {
      ruleId: "SN-MNT-006",
      severity: "warn" as const,
      path: "p",
      line: null,
      message: "m",
    };
    const text = planPush.render(
      {
        instance: "pdi",
        planId: "0123456789abcdef",
        label: "b",
        updateSets: ["snagentic: b"],
        units: [
          {
            project: "source/global",
            scope: "global",
            updateName: "sys_script_x",
            table: "sys_script",
            sysId: "s",
            name: "Rule",
            operation: "load",
            changes: ["sys_script.order"],
            losses: ["api-default"],
          },
        ],
        problems: [],
        gate: {
          passed: true,
          blocking: [],
          waived: [{ ...finding, reason: "legacy", approver: "pat" }],
          warnings: 0,
          waiverProblems: [{ index: 0, reason: "expired" }],
        },
        collisions: [
          {
            path: "source/global",
            record: "sys_script_x",
            heldBy: [{ updateSet: "s1", updateSetName: "Other", updatedBy: "sam" }],
          },
        ],
        ready: false,
        next: [],
      },
      "text",
    );
    expect(text.split("\n")).toEqual([
      "load   sys_script_x  source/global  (sys_script.order)  also sets: api-default",
      "waived:  SN-MNT-006 p (pat: legacy)",
      "waivers.yaml entry 1: expired",
      'held:    sys_script_x in "Other" (sam)',
      "update sets: snagentic: b",
      "not ready: fix the items above, then plan again",
    ]);
  });
});
