import { describe, expect, it } from "bun:test";
import { InstanceName } from "@snagentic/core";
import { type CallUseCase, installSteps } from "../../src/registry/install-steps";
import type { UseCaseContext } from "../../src/registry/use-case";
import { FAKE_CONTEXT } from "../support/fakes";

// What each use case answers, by name: only the fields the install reads.
const ANSWERS: Readonly<Record<string, unknown>> = {
  activate: { seconds: 42 },
  pull: {},
  integrate: {},
  add: { copied: ["source/global/src/fluent/imports.now.ts"], conflicts: [] },
  "fluent-keys": { written: [{ path: "source/global", added: ["a"] }] },
  "plan-push": {
    planId: "p1",
    ready: false,
    units: [{}, {}],
    problems: [{ updateName: "sys_x_1", project: "source/global", reason: "drift" }],
    gate: { blocking: [{ ruleId: "SN-MNT-010", path: "keys.ts", message: "new IDs" }] },
    collisions: [{ record: "sys_y_2" }],
  },
  push: {
    units: [{}, {}, {}],
    notApplied: 0,
    notCaptured: 1,
    updateSets: [{ name: "snagentic: L" }],
  },
  load: { entities: [], stopped: false },
};

function fakes() {
  const calls: [string, unknown][] = [];
  const commits: [readonly string[], string][] = [];
  const written: [string, string][] = [];
  // The fake answers any use case by name; the install only reads the fields listed above.
  const call = (async (useCase: { name: string }, input: unknown) => {
    calls.push([useCase.name, input]);
    return ANSWERS[useCase.name];
  }) as CallUseCase;
  const context: UseCaseContext = {
    ...FAKE_CONTEXT,
    delivery: () =>
      ({
        commitFiles: async (paths: readonly string[], message: string) => {
          commits.push([paths, message]);
          return "c1";
        },
      }) as unknown as ReturnType<UseCaseContext["delivery"]>,
    workspaceFiles: {
      read: async () => null,
      write: async (path, text) => {
        written.push([path, text]);
      },
    },
  };
  const steps = installSteps(
    context,
    { root: "/w", instance: InstanceName.parse("pdi"), pack: "itsm" },
    call,
  );
  return { steps, calls, commits, written };
}

const signal = new AbortController().signal;

describe("an install's steps are the existing use cases (ADR-0038, item 2)", () => {
  it("activates a plugin with the install's confirmation, and refreshes with pull then integrate", async () => {
    const { steps, calls } = fakes();
    expect(await steps.activatePlugin("com.snc.cmdb.csdm", signal)).toEqual({ seconds: 42 });
    await steps.refresh(signal);
    expect(calls).toEqual([
      ["activate", { instance: "pdi", id: "com.snc.cmdb.csdm", confirm: true }],
      ["pull", { instance: "pdi" }],
      ["integrate", { instance: "pdi" }],
    ]);
  });

  it("adds modules, then writes and commits the keys of the projects they changed", async () => {
    const { steps, calls, commits } = fakes();
    const added = await steps.add(["foundation"], signal);
    await steps.keys(added.copied, signal);
    await steps.keys([], signal);
    expect(calls).toEqual([
      ["add", { pack: "itsm", instance: "pdi", modules: ["foundation"] }],
      ["fluent-keys", { paths: ["source/global/src/fluent/imports.now.ts"] }],
    ]);
    expect(commits).toEqual([
      [
        ["source/global/src/fluent/generated/keys.ts"],
        "chore(snagentic): keys for the accelerator's new records",
      ],
    ]);
  });

  it("plans and pushes a module under its label, naming every reason it is not ready", async () => {
    const { steps, calls } = fakes();
    expect(await steps.planPush("L", signal)).toEqual({
      planId: "p1",
      ready: false,
      units: 2,
      problems: [
        "sys_x_1: drift",
        "SN-MNT-010 keys.ts: new IDs",
        "sys_y_2 is held in another update set",
      ],
    });
    expect(await steps.push("p1", "L", signal)).toEqual({
      units: 3,
      notApplied: 0,
      notCaptured: 1,
      updateSets: ["snagentic: L"],
    });
    expect(calls.map(([name, input]) => [name, input])).toEqual([
      ["plan-push", { instance: "pdi", label: "L" }],
      ["push", { instance: "pdi", plan: "p1", confirm: true, label: "L" }],
    ]);
  });

  it("loads the demo data or a customer directory, and writes and commits workspace files", async () => {
    const { steps, calls, commits, written } = fakes();
    await steps.load(["foundation"], { kind: "demo" }, signal);
    await steps.load(["foundation"], { kind: "directory", directory: "/data" }, signal);
    await steps.writeFile("accelerators/installs/pdi/x/plan.md", "# plan");
    await steps.commit(["accelerators/installs/pdi/x/plan.md"], "install");
    expect(calls).toEqual([
      [
        "load",
        { pack: "itsm", instance: "pdi", modules: ["foundation"], confirm: true, demo: true },
      ],
      [
        "load",
        { pack: "itsm", instance: "pdi", modules: ["foundation"], confirm: true, data: "/data" },
      ],
    ]);
    expect(written).toEqual([["/w/accelerators/installs/pdi/x/plan.md", "# plan"]]);
    expect(commits).toEqual([[["accelerators/installs/pdi/x/plan.md"], "install"]]);
  });
});
