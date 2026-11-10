import { afterEach, expect, describe as group, it } from "bun:test";
import { runGitOrThrow } from "../../src/adapters/git/run-git";
import { executeUseCase } from "../../src/registry/execute";
import { integrate } from "../../src/registry/integrate";
import { planPush } from "../../src/registry/plan-push";
import { pull } from "../../src/registry/pull";
import { push } from "../../src/registry/push";
import { team } from "../support/team-workspace";
import { adoptS11, PLAN_TIMEOUT, SI_UNIT, s11Tables } from "../support/unit-workspace";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

const tables = (queries: readonly { table: unknown }[]) => queries.map((q) => String(q.table));

// ADR-0052, delivery from a clone: a developer who never pulled plans and pushes from the shared
// mirror. The toolchain is the plan-push tests' fake (the SDK's own built file,
// tests/fixtures/sdk): registry tests never run the SDK build; the gate's Fluent checks do run
// in-process. In the Windows known failures with plan-push and push (the same tar path issue).
group("a team on one shared mirror, delivering", () => {
  it(
    "plans and pushes from a clone that never pulled, once it integrates",
    async () => {
      const t = await team({
        ...s11Tables("", "dev.one"),
        sys_db_object: [
          { sys_id: "c0", name: "sys_metadata", super_class: "" },
          { sys_id: "c2", name: "sys_script_include", super_class: "c0" },
        ],
        sys_scope: [
          { sys_id: "global", scope: "global" },
          { sys_id: "489da54ae67c4a3e9f1e1e4347e9119b", scope: "x_2222332_s11" },
        ],
      });
      cleanups.push(t.cleanup);
      const ci = await t.member("svc_ci");
      await executeUseCase(pull, { instance: "pdi", publish: true }, ci.at("2026-10-17T12:00:00Z"));
      const fullRequests = t.instance.queries.length;

      const dev = await t.member("dev.one");
      const at = "2026-10-17T12:05:00Z";
      await executeUseCase(integrate, { instance: "pdi" }, dev.at(at));
      const ws = { root: dev.root, context: dev.at(at), instance: t.instance };
      const { context } = await adoptS11(ws, {
        source: "Edited in source.",
        instance: "",
        username: "dev.one",
      });
      const plan = await executeUseCase(planPush, {}, context);
      expect(plan.output).toMatchObject({
        ready: true,
        units: [{ updateName: SI_UNIT, operation: "load" }],
      });
      const pushed = await executeUseCase(
        push,
        { instance: "pdi", plan: String(plan.output["planId"]), confirm: true },
        context,
      );
      expect(pushed.exitCode).toBe(0);
      expect(pushed.output).toMatchObject({
        units: [{ updateName: SI_UNIT, captured: true, applied: true }],
        notApplied: 0,
      });
      expect(t.instance.tables["sys_script_include"]?.[0]?.["description"]).toBe(
        "Edited in source.",
      );
      // The clone never pulled: its plan and push read only the records they check, against the
      // shared mirror's base.
      expect(tables(t.instance.queries.slice(0, fullRequests))).toContain("sys_metadata");
      expect(tables(t.instance.queries.slice(fullRequests))).not.toContain("sys_metadata");
      expect(await runGitOrThrow(["log", "-1", "--format=%s"], dev.root)).toContain(
        "ledger after push",
      );
    },
    PLAN_TIMEOUT,
  );
});
