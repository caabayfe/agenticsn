import { describe, expect, it } from "bun:test";
import { type Finding, gateOf, globMatches, readWaivers } from "@snagentic/core";

describe("waivers", () => {
  const today = new Date("2026-10-06T12:00:00Z");
  const valid = {
    rule: "SN-SEC-001",
    path: "source/global/**",
    reason: "r",
    approver: "a",
    expires: "2027-01-01",
  };

  it("keeps waivers in force and reports expired, too-long and malformed ones", () => {
    const { waivers, problems } = readWaivers(
      {
        waivers: [
          valid,
          { ...valid, expires: "2026-10-01" },
          { ...valid, expires: "2028-01-01" },
          { ...valid, approver: "" },
          { ...valid, expires: "soon" },
          "x",
        ],
      },
      today,
    );
    expect(waivers).toEqual([valid]);
    expect(problems.map((p) => [p.index, p.reason])).toEqual([
      [1, "expired on 2026-10-01"],
      [2, "expires more than 366 days ahead"],
      [3, "missing approver"],
      [4, "expires must be a date (YYYY-MM-DD)"],
      [5, "not a mapping"],
    ]);
    expect(readWaivers(null, today)).toEqual({ waivers: [], problems: [] });
  });

  it("refuses a waiver whose path does not name a scope's source, or names the mirror", () => {
    const paths = [
      "**",
      "source/**",
      "source/*/x.js",
      "source/g*/**",
      "source/global/../../**",
      "instances/dev/metadata/global/**",
    ];
    const { waivers, problems } = readWaivers(
      { waivers: paths.map((path) => ({ ...valid, path })) },
      today,
    );
    expect(waivers).toEqual([]);
    expect(problems).toHaveLength(paths.length);
    expect(problems[0]?.reason).toContain("source/<scope>/");
  });

  it("matches paths by glob: * and ? within a folder, ** across folders", () => {
    expect(globMatches("a/*/c.js", "a/b/c.js")).toBe(true);
    expect(globMatches("a/*/c.js", "a/b/x/c.js")).toBe(false);
    expect(globMatches("a/**/c.js", "a/b/x/c.js")).toBe(true);
    expect(globMatches("a/?.js", "a/b.js")).toBe(true);
    expect(globMatches("a/b.js", "a/bxjs")).toBe(false);
  });
});

describe("the gate", () => {
  const finding = (ruleId: string, severity: "block" | "warn"): Finding => ({
    ruleId,
    severity,
    title: "",
    path: "source/global/src/fluent/rule.server.js",
    root: "workspace",
    field: "script",
    line: 3,
    message: "m",
    evidence: "",
    why: "",
    remediation: "",
  });
  const waiver = {
    rule: "SN-SEC-001",
    path: "source/global/**",
    reason: "approved",
    approver: "lead",
    expires: "2027-01-01",
  };

  it("passes only without unwaived block findings", () => {
    const findings = [finding("SN-SEC-001", "block"), finding("SN-MNT-001", "warn")];
    expect(gateOf(findings, [], [], "instances/dev/metadata")).toMatchObject({
      passed: false,
      warnings: 1,
    });
    const waived = gateOf(findings, [waiver], [], "instances/dev/metadata");
    expect(waived).toMatchObject({
      passed: true,
      blocking: [],
      waived: [{ ruleId: "SN-SEC-001", approver: "lead" }],
    });
  });
});
