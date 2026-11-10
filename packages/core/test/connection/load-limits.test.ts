import { describe, expect, it } from "bun:test";
import fc from "fast-check";
import { defaultLoadLimits, effectiveLoadLimits } from "../../src/connection/domain/load-limits";
import { INSTANCE_KINDS } from "../../src/instance/domain/profile";

describe("load limits (ADR-0053)", () => {
  it("allows less concurrency and a slower rate on test and production than on development", () => {
    const development = defaultLoadLimits("development");
    for (const kind of ["test", "production"] as const) {
      const limits = defaultLoadLimits(kind);
      expect(limits.maxConcurrency).toBe(2);
      expect(limits.maxConcurrency).toBeLessThan(development.maxConcurrency);
      expect(limits.requestsPerSecond).toBeLessThan(development.requestsPerSecond);
    }
  });

  it("gives a run a budget large enough for a full pull of a developer instance", () => {
    for (const kind of INSTANCE_KINDS) {
      expect(defaultLoadLimits(kind).requestBudget).toBeGreaterThan(5_180 * 3);
    }
  });

  it("lets instance.yaml lower every limit", () => {
    const limits = effectiveLoadLimits("production", {
      file: { maxConcurrency: 1, requestsPerSecond: 2, requestBudget: 500 },
    });
    expect(limits).toEqual({ maxConcurrency: 1, requestsPerSecond: 2, requestBudget: 500 });
  });

  it("never lets instance.yaml raise a limit", () => {
    const limits = effectiveLoadLimits("production", {
      file: { maxConcurrency: 16, requestsPerSecond: 100, requestBudget: 1_000_000 },
    });
    expect(limits).toEqual(defaultLoadLimits("production"));
  });

  it("lets the environment raise the budget, but not concurrency or rate", () => {
    const limits = effectiveLoadLimits("development", {
      environment: { maxConcurrency: 16, requestsPerSecond: 100, requestBudget: 80_000 },
    });
    expect(limits).toEqual({ ...defaultLoadLimits("development"), requestBudget: 80_000 });
  });

  it("keeps the lower of the environment and instance.yaml", () => {
    const limits = effectiveLoadLimits("development", {
      environment: { maxConcurrency: 1, requestBudget: 80_000 },
      file: { maxConcurrency: 3, requestBudget: 40_000 },
    });
    expect(limits).toMatchObject({ maxConcurrency: 1, requestBudget: 40_000 });
  });

  it("never exceeds the kind's concurrency and rate, whatever the settings", () => {
    const setting = fc.option(fc.integer({ min: 1, max: 1_000 }), { nil: undefined });
    const settings = fc.record(
      { maxConcurrency: setting, requestsPerSecond: setting, requestBudget: setting },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(fc.constantFrom(...INSTANCE_KINDS), settings, settings, (kind, file, env) => {
        const defaults = defaultLoadLimits(kind);
        const strip = (value: typeof file) =>
          Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
        const limits = effectiveLoadLimits(kind, { file: strip(file), environment: strip(env) });
        expect(limits.maxConcurrency).toBeLessThanOrEqual(defaults.maxConcurrency);
        expect(limits.requestsPerSecond).toBeLessThanOrEqual(defaults.requestsPerSecond);
        expect(limits.maxConcurrency).toBeGreaterThanOrEqual(1);
      }),
    );
  });
});
