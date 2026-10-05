import { describe, expect, it } from "bun:test";
import { checkArchitecture } from "../../scripts/arch";

const FIXTURES = "tests/fixtures/arch/packages";

async function rulesBrokenBy(file: string): Promise<string[]> {
  const report = await fixtureReport;
  return report.violations
    .filter((violation) => violation.from === `${FIXTURES}/${file}`)
    .map((violation) => violation.rule.name);
}

const fixtureReport = checkArchitecture([FIXTURES]);

describe("architecture boundaries", () => {
  it("forbids kernel code from importing Node built-ins", async () => {
    expect(await rulesBrokenBy("core/src/kernel/impure.ts")).toContain(
      "kernel-and-domain-are-pure",
    );
  });

  it("forbids domain code from importing Bun built-ins", async () => {
    expect(await rulesBrokenBy("core/src/sync/domain/uses-bun.ts")).toContain(
      "kernel-and-domain-are-pure",
    );
  });

  it("forbids kernel code from importing npm packages other than @noble/hashes", async () => {
    expect(await rulesBrokenBy("core/src/kernel/uses-npm.ts")).toContain(
      "kernel-and-domain-are-pure",
    );
  });

  it("forbids the core package from depending on the cli package", async () => {
    expect(await rulesBrokenBy("core/src/kernel/uses-cli.ts")).toContain(
      "core-does-not-depend-on-cli",
    );
  });

  it("forbids the use-case registry from importing adapters", async () => {
    expect(await rulesBrokenBy("cli/src/registry/uses-adapter.ts")).toContain(
      "interfaces-do-not-import-adapters",
    );
  });

  it("forbids importing another package's internals", async () => {
    expect(await rulesBrokenBy("cli/src/deep.ts")).toContain("no-deep-imports-across-packages");
  });

  it("forbids circular dependencies", async () => {
    expect(await rulesBrokenBy("core/src/kernel/cycle-a.ts")).toContain("no-circular");
  });

  it("accepts kernel code that only depends on itself", async () => {
    expect(await rulesBrokenBy("core/src/kernel/clean.ts")).toEqual([]);
  });

  it("analyses the real packages and finds no violations", async () => {
    const report = await checkArchitecture(["packages"]);
    expect(report.modulesCruised).toBeGreaterThan(0);
    expect(report.violations).toEqual([]);
  });
});
