import { afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { recordHash } from "@snagentic/core";
import { runGitOrThrow } from "../../src/adapters/git/run-git";
import { toYaml } from "../../src/adapters/yaml/own-style";
import { executeUseCase } from "../../src/registry/execute";
import { planPush } from "../../src/registry/plan-push";
import { push } from "../../src/registry/push";
import { instanceWorkspace } from "../support/instance-workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const META = "instances/pdi/metadata";
const SYS_ID = "0123456789abcdef0123456789abcdef";
const INCLUDE = `global/sys_script_include/util--${SYS_ID}`;
const FIELDS = { name: "Util", description: "Helpers", script: "var Util = Class.create();" };

async function workspace() {
  const ws = await instanceWorkspace({
    sys_user: [{ sys_id: "u1", user_name: "admin" }],
    sys_update_set: [],
    sys_update_xml: [],
    sys_user_preference: [],
    sys_script_include: [
      { sys_id: SYS_ID, sys_class_name: "sys_script_include", sys_scope: "global", ...FIELDS },
    ],
  });
  cleanups.push(ws.cleanup);
  const write = async (path: string, content: string) => {
    await mkdir(join(ws.root, META, path, ".."), { recursive: true });
    await writeFile(join(ws.root, META, path), content);
  };
  await write(
    `${INCLUDE}.yaml`,
    toYaml({
      _meta: {
        sys_class_name: "sys_script_include",
        sys_id: SYS_ID,
        scope: "global",
        hash: recordHash("sys_script_include", FIELDS),
      },
      name: FIELDS.name,
      description: FIELDS.description,
    }),
  );
  await write(`${INCLUDE}.script.js`, `${FIELDS.script}\n`);
  await runGitOrThrow(["add", "instances"], ws.root);
  await runGitOrThrow(
    ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "pull"],
    ws.root,
  );
  await runGitOrThrow(["branch", "servicenow-remote/pdi"], ws.root);
  return { ...ws, write };
}

describe("push", () => {
  it("writes a reviewed plan into the branch's update set and reports it", async () => {
    const { context, write, instance, root } = await workspace();
    await write(`${INCLUDE}.script.js`, "var Util = Class.create();\nUtil.prototype = {};\n");
    const plan = await executeUseCase(planPush, {}, context);
    const planId = String(plan.output["planId"]);
    const { output, exitCode } = await executeUseCase(
      push,
      { instance: "pdi", plan: planId, confirm: true },
      context,
    );
    expect(exitCode).toBe(0);
    expect(output).toMatchObject({
      planId,
      updateSets: [{ name: "snagentic: main [global]", created: true }],
      written: [{ operation: "update", table: "sys_script_include", captured: true }],
      notCaptured: 0,
    });
    expect(instance.writes).toContain(
      "update sys_script_include script=var Util = Class.create();\nUtil.prototype = {};",
    );
    expect(existsSync(join(root, ".snagentic/pdi/push-journal.json"))).toBe(false);
    const text = push.render(output as never, "text");
    expect(text).toContain("update set created: snagentic: main [global]");
    expect(text).toContain("next: snagentic pull --instance pdi, then integrate");
  });

  it("refuses without confirmation, and explains a capture problem", async () => {
    const { context } = await workspace();
    await expect(
      executeUseCase(push, { instance: "pdi", plan: "x" }, context),
    ).rejects.toMatchObject({
      code: "push-confirmation-required",
    });
    const text = push.render(
      {
        instance: "pdi",
        planId: "p",
        updateSets: [],
        written: [{ operation: "update", table: "t", sysId: "s", path: "p.yaml", captured: false }],
        notCaptured: 1,
        next: [],
      },
      "text",
    );
    expect(text).toContain("NOT captured");
    expect(text).toContain("1 write(s) were not captured");
  });
});
