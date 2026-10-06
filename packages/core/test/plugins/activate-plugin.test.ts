import { describe, expect, it } from "bun:test";
import {
  AccessDeniedError,
  type ActivationProgress,
  activatePlugin,
  InstanceError,
  KeysetPager,
  type PluginActivator,
} from "@snagentic/core";
import { fakeInstance } from "../support/fake-instance";

const LIVE = new AbortController().signal;
const step = (
  status: ActivationProgress["status"],
  percent = 0,
  extra: Partial<ActivationProgress> = {},
): ActivationProgress => ({
  progressId: "prog1",
  status,
  percent,
  message: "",
  error: "",
  ...extra,
});

function setup(
  active: string,
  progress: (ActivationProgress | Error)[],
  start: ActivationProgress | Error = step("pending"),
) {
  const instance = fakeInstance({
    v_plugin: [{ sys_id: "p1", id: "com.snc.cool", name: "Cool plugin", active }],
  });
  const calls = { activate: 0, progress: 0, sleeps: 0 };
  let time = 0;
  const activator: PluginActivator = {
    activate: async () => {
      calls.activate += 1;
      if (start instanceof Error) {
        throw start;
      }
      return start;
    },
    progress: async () => {
      const next = progress[calls.progress] ?? step("running");
      calls.progress += 1;
      if (next instanceof Error) {
        throw next;
      }
      return next;
    },
  };
  const deps = {
    pager: new KeysetPager(instance.reader),
    activator,
    sleep: async (ms: number) => {
      calls.sleeps += 1;
      time += ms;
    },
    now: () => new Date(time),
  };
  return { deps, calls };
}

const LIMITS = { pollMs: 5_000, maxWaitMs: 60_000 };

describe("activatePlugin", () => {
  it("does nothing for a plugin that is already active", async () => {
    const { deps, calls } = setup("active", []);
    expect(await activatePlugin(deps, "pdi", "com.snc.cool", LIVE)).toEqual({
      state: "already-active",
      name: "Cool plugin",
    });
    expect(calls.activate).toBe(0);
  });

  it("refuses an id the instance does not have", async () => {
    const { deps, calls } = setup("inactive", []);
    await expect(activatePlugin(deps, "pdi", "com.snc.nope", LIVE)).rejects.toMatchObject({
      code: "plugin-not-found",
    });
    expect(calls.activate).toBe(0);
  });

  it("starts the activation once and follows its progress to success", async () => {
    const { deps, calls } = setup("inactive", [
      step("running", 40),
      step("running", 80),
      step("successful", 100),
    ]);
    const reported: number[] = [];
    const outcome = await activatePlugin(
      deps,
      "pdi",
      "com.snc.cool",
      LIVE,
      (p) => reported.push(p.percent),
      LIMITS,
    );
    expect(outcome).toEqual({
      state: "activated",
      name: "Cool plugin",
      progressId: "prog1",
      seconds: 15,
    });
    expect(calls.activate).toBe(1);
    expect(reported).toEqual([0, 40, 80]);
  });

  it("reports a failure the instance states", async () => {
    const { deps } = setup("inactive", [step("failed", 50, { error: "dependency missing" })]);
    await expect(
      activatePlugin(deps, "pdi", "com.snc.cool", LIVE, () => {}, LIMITS),
    ).rejects.toMatchObject({
      code: "plugin-activation-failed",
      message: expect.stringContaining("dependency missing"),
    });
  });

  it("passes on a refusal the instance states when asked to start", async () => {
    const { deps, calls } = setup(
      "inactive",
      [],
      new AccessDeniedError("plugin activation", "needs sn_cicd.sys_ci_automation"),
    );
    await expect(activatePlugin(deps, "pdi", "com.snc.cool", LIVE)).rejects.toMatchObject({
      code: "access-denied",
    });
    expect(calls.activate).toBe(1);
  });

  it("calls the outcome unknown, and does not retry, when the start's answer is lost", async () => {
    const { deps, calls } = setup("inactive", [], new InstanceError("HTTP 504: gateway timeout"));
    await expect(activatePlugin(deps, "pdi", "com.snc.cool", LIVE)).rejects.toMatchObject({
      code: "activation-state-unknown",
      hint: expect.stringContaining("not retried"),
    });
    expect(calls.activate).toBe(1);
  });

  it("calls the outcome unknown when progress cannot be read, naming the progress to check", async () => {
    const { deps, calls } = setup("inactive", [new InstanceError("HTTP 500")]);
    await expect(
      activatePlugin(deps, "pdi", "com.snc.cool", LIVE, () => {}, LIMITS),
    ).rejects.toMatchObject({
      code: "activation-state-unknown",
      hint: expect.stringContaining("prog1"),
    });
    expect(calls.activate).toBe(1);
  });

  it("stops waiting after the time limit without calling it a failure", async () => {
    const { deps, calls } = setup("inactive", []);
    await expect(
      activatePlugin(deps, "pdi", "com.snc.cool", LIVE, () => {}, LIMITS),
    ).rejects.toMatchObject({
      code: "activation-state-unknown",
      message: expect.stringContaining("still running after 1 min"),
    });
    expect(calls.activate).toBe(1);
    expect(calls.sleeps).toBe(12);
  });

  it("works without a progress reporter, with the default limits", async () => {
    const { deps } = setup("inactive", [step("running", 50), step("successful", 100)]);
    expect(await activatePlugin(deps, "pdi", "com.snc.cool", LIVE)).toMatchObject({
      state: "activated",
    });
  });

  it("calls the outcome unknown even when the failure is not an Error", async () => {
    const { deps } = setup("inactive", [], "socket hang up" as unknown as Error);
    const thrown = {
      activate: async () => Promise.reject("socket hang up"),
      progress: deps.activator.progress,
    };
    await expect(
      activatePlugin({ ...deps, activator: thrown }, "pdi", "com.snc.cool", LIVE),
    ).rejects.toMatchObject({
      code: "activation-state-unknown",
      message: expect.stringContaining("socket hang up"),
    });
  });
});
