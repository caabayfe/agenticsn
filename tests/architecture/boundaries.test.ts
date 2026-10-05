import { describe, expect, it } from "bun:test";
import { cruise, type IConfiguration, type IViolation } from "dependency-cruiser";
import config from "../../.dependency-cruiser.cjs";

const FIXTURES = "tests/fixtures/arch/packages";

async function violationsIn(paths: string[]): Promise<IViolation[]> {
  const rules: IConfiguration = config;
  const result = await cruise(paths, {
    ...rules.options,
    validate: true,
    ruleSet: { forbidden: rules.forbidden ?? [] },
  });
  if (typeof result.output === "string") {
    throw new Error("expected a structured cruise result");
  }
  return result.output.summary.violations;
}

function rulesBrokenBy(violations: IViolation[], file: string): string[] {
  return violations
    .filter((violation) => violation.from === `${FIXTURES}/${file}`)
    .map((violation) => violation.rule.name);
}

describe("architecture boundaries", () => {
  const fixtureViolations = violationsIn([FIXTURES]);

  it("forbids kernel code from importing Node built-ins", async () => {
    expect(rulesBrokenBy(await fixtureViolations, "core/src/kernel/impure.ts")).toContain(
      "kernel-and-domain-are-pure",
    );
  });

  it("forbids domain code from importing Bun built-ins", async () => {
    expect(rulesBrokenBy(await fixtureViolations, "core/src/sync/domain/uses-bun.ts")).toContain(
      "kernel-and-domain-are-pure",
    );
  });

  it("forbids the core package from depending on the cli package", async () => {
    expect(rulesBrokenBy(await fixtureViolations, "core/src/kernel/uses-cli.ts")).toContain(
      "core-does-not-depend-on-cli",
    );
  });

  it("forbids the use-case registry from importing adapters", async () => {
    expect(rulesBrokenBy(await fixtureViolations, "cli/src/registry/uses-adapter.ts")).toContain(
      "interfaces-do-not-import-adapters",
    );
  });

  it("forbids importing another package's internals", async () => {
    expect(rulesBrokenBy(await fixtureViolations, "cli/src/deep.ts")).toContain(
      "no-deep-imports-across-packages",
    );
  });

  it("forbids circular dependencies", async () => {
    expect(rulesBrokenBy(await fixtureViolations, "core/src/kernel/cycle-a.ts")).toContain(
      "no-circular",
    );
  });

  it("accepts kernel code that only depends on itself", async () => {
    expect(rulesBrokenBy(await fixtureViolations, "core/src/kernel/clean.ts")).toEqual([]);
  });

  it("finds no violations in the real packages", async () => {
    expect(await violationsIn(["packages"])).toEqual([]);
  });
});
