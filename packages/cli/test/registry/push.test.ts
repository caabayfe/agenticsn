import { afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PushConfirmationRequiredError } from "@snagentic/core";
import { executeUseCase } from "../../src/registry/execute";
import { planPush } from "../../src/registry/plan-push";
import { push } from "../../src/registry/push";
import { SI_UNIT, unitWorkspace } from "../support/unit-workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function workspace(source: string) {
  const ws = await unitWorkspace({ source, instance: "" });
  cleanups.push(ws.cleanup);
  return ws;
}

describe("push (ADR-0031 item 4)", () => {
  // Plans, pushes and plans again, with the gate checking the loaded project in full each time
  // (#102): about 3 s here and 5 s on a CI runner, so it gets more than the default 5 s.
  it("loads a reviewed plan, stamped, into the branch's update sets, and commits the ledger", async () => {
    const { context, root, loads, tables, git } = await workspace("Edited in source.");
    const plan = await executeUseCase(planPush, {}, context);
    expect(plan.output).toMatchObject({
      ready: true,
      units: [{ updateName: SI_UNIT, operation: "load" }],
    });
    const planId = String(plan.output["planId"]);
    const { output, exitCode } = await executeUseCase(
      push,
      { instance: "pdi", plan: planId, confirm: true },
      context,
    );
    expect(exitCode).toBe(0);
    expect(output).toMatchObject({
      planId,
      batch: { name: "snagentic: main", created: true },
      updateSets: [
        { scope: "x_2222332_s11", name: "snagentic: main [x_2222332_s11]", created: true },
      ],
      units: [{ updateName: SI_UNIT, operation: "load", captured: true, applied: true }],
      notCaptured: 0,
      notApplied: 0,
    });
    // Stamped as a save would (ADR-0030 item 5).
    expect(loads[0]).toContain("<sys_mod_count>2</sys_mod_count>");
    expect(tables["sys_script_include"]?.[0]?.["description"]).toBe("Edited in source.");
    expect(existsSync(join(root, ".snagentic/pdi/push-journal.json"))).toBe(false);
    expect(await git("log", "-1", "--format=%s")).toContain(
      `chore(snagentic): ledger after push ${planId} to pdi`,
    );
    expect(await git("status", "--porcelain", "--", "source")).toBe("");
    const again = await executeUseCase(planPush, {}, context);
    expect(planPush.render(again.output as never, "text")).toContain("nothing to push");
  }, 15_000);

  it("refuses without confirmation", async () => {
    const { context } = await workspace("Edited in source.");
    const plan = await executeUseCase(planPush, {}, context);
    const planId = String(plan.output["planId"]);
    await expect(
      executeUseCase(push, { instance: "pdi", plan: planId }, context),
    ).rejects.toBeInstanceOf(PushConfirmationRequiredError);
  });

  it("shows the batch once, each other scope's update set, and what did not land as built and why", () => {
    const set = (name: string, sysId: string) => ({
      name,
      sysId,
      created: false,
      link: `l/${sysId}`,
    });
    const text = push.render(
      {
        instance: "pdi",
        planId: "p",
        batch: set("snagentic: main", "b1"),
        pullRequest: { status: "found", url: "https://github.com/a/b/pull/1" },
        updateSets: [
          { scope: "global", ...set("snagentic: main", "b1") },
          { scope: "x_acme", ...set("snagentic: main [x_acme]", "c1") },
        ],
        units: [
          {
            project: "source/x_acme",
            updateName: "u1",
            table: "t",
            name: "n",
            operation: "load",
            captured: true,
            applied: false,
            refused: "permission denied",
            mismatches: [],
          },
          {
            project: "source/x_acme",
            updateName: "u2",
            table: "sc_cat_item",
            name: "Peripherals",
            operation: "create",
            captured: true,
            applied: false,
            refused: null,
            mismatches: ['sc_cat_item.version: built "1", instance "3"'],
          },
        ],
        notCaptured: 0,
        notApplied: 2,
        refused: [{ table: "t", reason: "permission denied", records: ["n"], action: "do x" }],
        ledgerCommit: "0123456789abcdef",
        next: [],
      },
      "text",
    );
    expect(text.split("\n")).toEqual([
      "batch reused: snagentic: main  l/b1",
      "pull request: https://github.com/a/b/pull/1",
      "update set reused: snagentic: main [x_acme]  l/c1",
      "load   u1  NOT applied as built (refused: permission denied)",
      "create u2  NOT applied as built",
      '         sc_cat_item.version: built "1", instance "3"',
      "refused: 1 t record(s), permission denied: do x",
      "ledger committed: 0123456789",
      "0 load(s) not captured, 2 not applied as built: check them on the instance before moving the update set",
    ]);
  });
});
