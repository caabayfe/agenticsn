import { describe, expect, it } from "bun:test";
import { checkArchitecture, readBaseline } from "../../scripts/arch";

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

  it("forbids a rule or agent pack from importing anything but itself and the ESLint rule API", async () => {
    expect(await rulesBrokenBy("rules-basic/src/impure.ts")).toContain("packs-are-pure");
    expect(await rulesBrokenBy("rules-basic/src/index.ts")).toEqual([]);
    expect(await rulesBrokenBy("agent-packs/src/impure.ts")).toContain("packs-are-pure");
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

  it("forbids a core context from reaching into another context's internals", async () => {
    expect(await rulesBrokenBy("core/src/sync/application/reaches-in.ts")).toContain(
      "contexts-meet-through-their-index",
    );
  });

  it("lets a core context use another context's index, the kernel and its own internals", async () => {
    expect(await rulesBrokenBy("core/src/sync/application/uses-api.ts")).toEqual([]);
    expect(await rulesBrokenBy("core/src/sync/application/uses-own-domain.ts")).toEqual([]);
  });

  it("accepts kernel code that only depends on itself", async () => {
    expect(await rulesBrokenBy("core/src/kernel/clean.ts")).toEqual([]);
  });

  it("analyses the real packages and finds no violations beyond the baseline", async () => {
    const report = await checkArchitecture(["packages"], await readBaseline());
    expect(report.modulesCruised).toBeGreaterThan(0);
    expect(report.violations).toEqual([]);
  });
});

// The baseline records the cross-context reach-ins that existed when the rule was added
// (spec 014, QUAL2-02). It may only shrink: lower the ceiling when you remove entries, never
// raise it.
const BASELINE_CEILING = 94;

describe("architecture baseline", () => {
  const key = (violation: { from: string; to: string; rule: { name: string } }) =>
    `${violation.rule.name}: ${violation.from} -> ${violation.to}`;

  it("never grows beyond its ceiling", async () => {
    expect((await readBaseline()).length).toBeLessThanOrEqual(BASELINE_CEILING);
  });

  it("holds only cross-context reach-ins: every other rule stays at zero", async () => {
    const rules = new Set((await readBaseline()).map((violation) => violation.rule.name));
    expect([...rules]).toEqual(["contexts-meet-through-their-index"]);
  });

  it("lists only reach-ins that still exist, so a fixed one must leave the baseline", async () => {
    const current = new Set((await checkArchitecture(["packages"])).violations.map(key));
    const stale = (await readBaseline()).map(key).filter((entry) => !current.has(entry));
    expect(stale).toEqual([]);
  });
});
