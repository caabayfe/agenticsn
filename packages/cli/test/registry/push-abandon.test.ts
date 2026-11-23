import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createProfile,
  ensureDevelopmentInstance,
  InstanceName,
  PushConfirmationRequiredError,
} from "@snagentic/core";
import { executeUseCase } from "../../src/registry/execute";
import { planPush } from "../../src/registry/plan-push";
import { push } from "../../src/registry/push";
import type { UseCaseContext } from "../../src/registry/use-case";
import { PLAN_TIMEOUT, SI_UNIT, unitWorkspace } from "../support/unit-workspace";

// The exit of a delivery that recovery refuses (spec 016, R3; ADR-0050, amendment A1).

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const JOURNAL = ".snagentic/pdi/push-journal.json";

// A push whose load was applied and never captured: its receipt stays in the journal.
async function stoppedPush() {
  const ws = await unitWorkspace({ source: "Pending capture.", instance: "" });
  cleanups.push(ws.cleanup);
  const { context, tables } = ws;
  const profile = createProfile({
    name: InstanceName.parse("pdi"),
    url: "dev1",
    username: "admin",
    kind: "development",
    acknowledgeReadOnly: false,
  });
  ensureDevelopmentInstance(profile, "test");
  const reader = context.connections.openForWrite(profile, "test");
  const installer = reader.fluent;
  if (installer === undefined) throw new Error("no installer");
  const uncaptured: UseCaseContext = {
    ...context,
    connections: {
      ...context.connections,
      openForWrite: () => ({
        ...reader,
        fluent: {
          ...installer,
          load: async (...args: Parameters<typeof installer.load>) => {
            await installer.load(...args);
            tables["sys_update_xml"] = [];
          },
        },
      }),
    },
  };
  const plan = await executeUseCase(planPush, {}, uncaptured);
  const planId = String(plan.output["planId"]);
  await executeUseCase(push, { instance: "pdi", plan: planId, confirm: true }, uncaptured);
  const updateSet = tables["sys_update_set"]?.find((set) => set["name"] !== "snagentic: main");
  return { ...ws, planId, updateSet: updateSet?.["sys_id"] ?? "" };
}

// A context that fails the test on any connection or credential use: abandoning reads the
// journal and writes git, and nothing else.
function offline(context: UseCaseContext, opened: string[]): UseCaseContext {
  const refuse = (what: string) => () => {
    opened.push(what);
    throw new Error(`abandon must not ${what}`);
  };
  return {
    ...context,
    credentials: { ...context.credentials, read: refuse("read the credential") },
    connections: { open: refuse("open a connection"), openForWrite: refuse("open a connection") },
  };
}

describe("push --abandon-pending (ADR-0050, amendment A1)", () => {
  it(
    "abandons a pending delivery only after confirmation, and records what stays",
    async () => {
      const { context, root, git, planId, updateSet, instance } = await stoppedPush();
      const head = (await git("rev-parse", "HEAD")).trim();
      const journal = readFileSync(join(root, JOURNAL), "utf8");
      const unconfirmed = await executeUseCase(
        push,
        { instance: "pdi", plan: planId, abandonPending: true },
        context,
      ).catch((error: unknown) => error);
      expect(unconfirmed).toBeInstanceOf(PushConfirmationRequiredError);
      // The refusal already says what would stay, so the user can approve it.
      expect(String(unconfirmed)).toContain(SI_UNIT);
      expect(String(unconfirmed)).toContain(updateSet);
      expect(readFileSync(join(root, JOURNAL), "utf8")).toBe(journal);
      expect((await git("rev-parse", "HEAD")).trim()).toBe(head);

      const writes = instance.writes.length;
      const { output, exitCode } = await executeUseCase(
        push,
        { instance: "pdi", plan: planId, abandonPending: true, confirm: true },
        context,
      );
      expect(exitCode).toBe(0);
      expect(output).toMatchObject({
        planId,
        abandoned: [
          {
            updateName: SI_UNIT,
            operation: "load",
            outcome: "unverified",
            updateSet,
            link: `https://dev1.service-now.com/sys_update_set.do?sys_id=${updateSet}`,
          },
        ],
        units: [],
      });
      expect(instance.writes.length).toBe(writes);
      expect(existsSync(join(root, JOURNAL))).toBe(false);
      // The record of what stays is the workspace's own commit, and changes no file.
      const message = await git("log", "-1", "--format=%B");
      expect(message).toContain(
        `chore(snagentic): abandon pending delivery of push ${planId} to pdi`,
      );
      expect(message).toContain(SI_UNIT);
      expect(message).toContain(updateSet);
      expect(message).toContain("Nothing was rolled back");
      expect((await git("rev-parse", "HEAD")).trim()).toBe(String(output["ledgerCommit"]));
      expect((await git("rev-parse", "HEAD~1")).trim()).toBe(head);
      expect(await git("diff", "--stat", "HEAD~1", "HEAD")).toBe("");
      expect(push.render(output as never, "text")).toContain("nothing was rolled back");
      // The workspace plans again: what the abandoned push left shows as an ordinary change.
      const again = await executeUseCase(planPush, {}, context);
      expect(JSON.stringify(again.output)).not.toContain("unfinished delivery");
    },
    PLAN_TIMEOUT * 2,
  );

  it(
    "sends nothing to the instance and needs no credential",
    async () => {
      const { context, root, planId, instance } = await stoppedPush();
      const before = { queries: instance.queries.length, writes: instance.writes.length };
      const opened: string[] = [];
      await executeUseCase(
        push,
        { instance: "pdi", plan: planId, abandonPending: true, confirm: true },
        offline(context, opened),
      );
      expect(opened).toEqual([]);
      expect(instance.queries.length).toBe(before.queries);
      expect(instance.writes.length).toBe(before.writes);
      expect(existsSync(join(root, JOURNAL))).toBe(false);
    },
    PLAN_TIMEOUT * 2,
  );

  it(
    "refuses to abandon when nothing is pending",
    async () => {
      const ws = await unitWorkspace({ source: "Edited in source.", instance: "" });
      cleanups.push(ws.cleanup);
      await expect(
        executeUseCase(
          push,
          { instance: "pdi", plan: "any", abandonPending: true, confirm: true },
          ws.context,
        ),
      ).rejects.toMatchObject({ code: "no-pending-delivery" });
    },
    PLAN_TIMEOUT,
  );

  it(
    "refuses a plan id other than the stopped push's, and leaves the journal",
    async () => {
      const { context, root, planId } = await stoppedPush();
      const error = await executeUseCase(
        push,
        { instance: "pdi", plan: "another", abandonPending: true, confirm: true },
        context,
      ).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code: "pending-delivery-plan" });
      expect(String(error)).toContain(planId);
      expect(existsSync(join(root, JOURNAL))).toBe(true);
    },
    PLAN_TIMEOUT * 2,
  );

  it("shows what stays, that nothing was rolled back, and what is left to restore", () => {
    const text = push.render(
      {
        instance: "pdi",
        planId: "p1",
        batch: { name: "snagentic: main", sysId: "", created: false, link: "" },
        pullRequest: { status: "none" },
        updateSets: [],
        units: [],
        notCaptured: 0,
        notApplied: 0,
        refused: [],
        ledgerCommit: "0123456789abcdef",
        warnings: ["preferences are still switched"],
        abandoned: [
          {
            project: "source/x_app",
            updateName: "sys_script_include_a",
            operation: "load",
            outcome: "unknown",
            updateSet: "set1",
            link: "https://dev1/sys_update_set.do?sys_id=set1",
          },
          {
            project: "",
            updateName: "sys_script:s1",
            operation: "update",
            outcome: "unverified",
            updateSet: "",
            link: "",
          },
        ],
        next: [],
      },
      "text",
    );
    expect(text).toBe(
      [
        "abandoned the unfinished delivery of push p1 to pdi: nothing was rolled back, and this stays on the instance:",
        "load   sys_script_include_a  unknown  https://dev1/sys_update_set.do?sys_id=set1",
        "update sys_script:s1  unverified  update set not recorded",
        "recorded in commit 0123456789; no ledger changed",
        "warning: preferences are still switched",
        "next: snagentic plan-push --instance pdi",
      ].join("\n"),
    );
  });
});
