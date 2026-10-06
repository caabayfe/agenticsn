import { describe, expect, it } from "bun:test";
import { minutesSince, nextCommand, syncPhase } from "@snagentic/core";

describe("syncPhase", () => {
  it.each([
    [{ pulled: false, interrupted: false, unintegratedPulls: 0 }, "never-pulled"],
    [{ pulled: false, interrupted: true, unintegratedPulls: 0 }, "interrupted"],
    [{ pulled: true, interrupted: true, unintegratedPulls: 1 }, "interrupted"],
    [{ pulled: true, interrupted: false, unintegratedPulls: 2 }, "not-integrated"],
    [{ pulled: true, interrupted: false, unintegratedPulls: 0 }, "integrated"],
  ] as const)("reads %p as %p", (facts, phase) => {
    expect(syncPhase(facts)).toBe(phase);
  });
});

describe("nextCommand", () => {
  it("integrates pulls not yet merged, and pulls otherwise", () => {
    expect(nextCommand("not-integrated", "pdi")).toBe("snagentic integrate pdi");
    expect(nextCommand("interrupted", "pdi")).toBe("snagentic pull pdi");
    expect(nextCommand("never-pulled", "pdi")).toBe("snagentic pull pdi");
    expect(nextCommand("integrated", "pdi")).toBe("snagentic pull pdi");
  });
});

describe("minutesSince", () => {
  const now = new Date("2026-10-06T10:00:30Z");

  it("counts whole minutes since a raw UTC timestamp", () => {
    expect(minutesSince("2026-10-06 08:30:00", now)).toBe(90);
  });

  it("is zero for a timestamp in the future, such as a skewed clock", () => {
    expect(minutesSince("2026-10-06 10:05:00", now)).toBe(0);
  });

  it("rejects a value that is not a raw UTC timestamp", () => {
    expect(() => minutesSince("yesterday", now)).toThrow(/raw UTC/);
  });
});
