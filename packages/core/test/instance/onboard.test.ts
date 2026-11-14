import { describe, expect, it } from "bun:test";
import { type InstanceAnswer, type OnboardSteps, onboard } from "@snagentic/core";

function steps(overrides: Partial<OnboardSteps> = {}): OnboardSteps & { calls: string[] } {
  const calls: string[] = [];
  const record =
    <T>(name: string, result: T) =>
    async (): Promise<T> => {
      calls.push(name);
      return result;
    };
  return {
    calls,
    workspace: record("workspace", "done" as const),
    profile: record("profile", "done" as const),
    signIn: record("sign-in", { outcome: "ready" } as InstanceAnswer),
    doctor: record("doctor", { failed: [] as readonly string[] }),
    pull: record("pull", undefined),
    integrate: record("integrate", undefined),
    ...overrides,
  };
}

describe("onboard", () => {
  it("runs the steps in order and reports what it did", async () => {
    const fake = steps();
    const result = await onboard(fake);
    expect(fake.calls).toEqual(["workspace", "profile", "sign-in", "doctor", "pull", "integrate"]);
    expect(result.stoppedAt).toBeNull();
    expect(result.steps.map((s) => `${s.step}:${s.did}`)).toEqual([
      "workspace:done",
      "profile:done",
      "sign-in:done",
      "doctor:done",
      "pull:done",
      "integrate:done",
    ]);
  });

  it("reports a step already done, so a second run continues", async () => {
    const result = await onboard(
      steps({
        workspace: async () => "already",
        profile: async () => "already",
        signIn: async () => ({ outcome: "ready" }),
      }),
    );
    expect(result.steps.slice(0, 2).map((s) => s.did)).toEqual(["already", "already"]);
    expect(result.stoppedAt).toBeNull();
  });

  it("stops at a sleeping instance, before it asks anything else of it", async () => {
    const asleep: InstanceAnswer = { outcome: "asleep", message: "it sleeps", hint: "wake it" };
    const fake = steps({ signIn: async () => asleep });
    const result = await onboard(fake);
    expect(result.stoppedAt).toBe("sign-in");
    expect(result.answer).toEqual(asleep);
    expect(fake.calls).toEqual(["workspace", "profile"]);
  });

  it("stops before the pull when doctor finds a failed check, and names it", async () => {
    const fake = steps({ doctor: async () => ({ failed: ["roles", "timestamps"] }) });
    const result = await onboard(fake);
    expect(result.stoppedAt).toBe("doctor");
    expect(result.failedChecks).toEqual(["roles", "timestamps"]);
    expect(fake.calls).not.toContain("pull");
  });

  it("does not hide an error a step throws", async () => {
    await expect(
      onboard(
        steps({
          pull: async () => {
            throw new Error("disk full");
          },
        }),
      ),
    ).rejects.toThrow("disk full");
  });
});
