import { describe, expect, it } from "bun:test";
import { computeUnitPlan } from "@snagentic/core";
import { governanceOf, unitOf } from "../support/fake-governance";
import { QUERY, unitSetup } from "./unit-fixture";

// ADR-0058: which waivers the gate accepts. Solo: the ones committed on the branch. Team (the
// profile names a shared mirror): only the ones on the remote's default branch.
const waiver = {
  rule: "SN-SEC-001",
  path: "source/x_app/**",
  reason: "Known, replaced in STRY0012345",
  approver: "lead@example.com",
  expires: "2027-03-31",
};
const blocked = (id: string) =>
  unitOf("sys_script_include", { script: "eval(a); /*SN-SEC-001*/" }, id);

function planWith(
  state: Parameters<typeof unitSetup>[1],
  team: boolean,
  units = [blocked("a".repeat(32))],
) {
  const { deps, project } = unitSetup({ source: "Edited in source." }, state);
  const governance = governanceOf({ [project.path]: { now: units, base: null } });
  return computeUnitPlan(
    { ...deps, governance, ...(team ? { reviewedRemote: "origin" } : {}) },
    QUERY,
  );
}

describe("the waivers the gate accepts (ADR-0058)", () => {
  it("keeps accepting a committed waiver in solo mode", async () => {
    const { plan } = await planWith({ waivers: { waivers: [waiver] } }, false);
    expect(plan.gate.passed).toBe(true);
    expect(plan.gate.waived).toMatchObject([{ ruleId: "SN-SEC-001", approver: waiver.approver }]);
    expect(plan.gate.waiverProblems).toEqual([]);
  });

  it("lists every waived finding in the plan", async () => {
    const units = [blocked("a".repeat(32)), blocked("b".repeat(32))];
    const { plan } = await planWith({ waivers: { waivers: [waiver] } }, false, units);
    expect(plan.gate.blocking).toEqual([]);
    expect(plan.gate.waived).toHaveLength(2);
    expect(new Set(plan.gate.waived.map((f) => f.path)).size).toBe(2);
  });

  it("ignores a waiver that is not on the reviewed branch in team mode", async () => {
    const { plan } = await planWith(
      {
        waivers: { waivers: [waiver] },
        reviewed: { kind: "found", branch: "origin/main", document: null },
      },
      true,
    );
    expect(plan.gate.passed).toBe(false);
    expect(plan.ready).toBe(false);
    expect(plan.gate.waived).toEqual([]);
    expect(plan.gate.waiverProblems).toEqual([
      {
        index: -1,
        reason:
          "the waiver for SN-SEC-001 on source/x_app/** is not on origin/main, so it does not apply: open a pull request for it, and run git fetch origin once it is merged",
      },
    ]);
  });

  it("ignores a waiver whose terms differ from the reviewed branch's in team mode", async () => {
    const { plan } = await planWith(
      {
        waivers: { waivers: [waiver] },
        reviewed: {
          kind: "found",
          branch: "origin/main",
          document: { waivers: [{ ...waiver, path: "source/x_other/**" }] },
        },
      },
      true,
    );
    expect(plan.gate.passed).toBe(false);
    expect(plan.gate.waiverProblems).toHaveLength(1);
  });

  it("reports nothing about a waiver the branch and the reviewed branch both hold", async () => {
    const { plan } = await planWith(
      {
        waivers: { waivers: [waiver] },
        reviewed: { kind: "found", branch: "origin/main", document: { waivers: [waiver] } },
      },
      true,
    );
    expect(plan.gate.passed).toBe(true);
    expect(plan.gate.waiverProblems).toEqual([]);
  });

  it("accepts a waiver on the reviewed branch in team mode, even before the branch has it", async () => {
    const { plan } = await planWith(
      {
        waivers: null,
        reviewed: { kind: "found", branch: "origin/main", document: { waivers: [waiver] } },
      },
      true,
    );
    expect(plan.gate.passed).toBe(true);
    expect(plan.gate.waived).toHaveLength(1);
    expect(plan.gate.waiverProblems).toEqual([]);
  });

  it("accepts no waiver in team mode when the clone cannot name the reviewed branch", async () => {
    const { plan } = await planWith({ waivers: { waivers: [waiver] } }, true);
    expect(plan.gate.passed).toBe(false);
    expect(plan.gate.waiverProblems).toEqual([
      {
        index: -1,
        reason:
          "this clone does not know the default branch of origin, so no waiver applies: run git remote set-head origin --auto",
      },
    ]);
  });

  it("reports uncommitted waivers in team mode as not applying", async () => {
    const { plan } = await planWith(
      {
        waivers: null,
        waiversUncommitted: true,
        reviewed: { kind: "found", branch: "origin/main", document: null },
      },
      true,
    );
    expect(plan.gate.waiverProblems).toEqual([
      {
        index: -1,
        reason:
          "waivers.yaml has uncommitted changes; only waivers on origin/main apply: open a pull request for them",
      },
    ]);
  });
});
