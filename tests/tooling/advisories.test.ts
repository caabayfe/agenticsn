import { describe, expect, it } from "bun:test";
import { compareAdvisories, parseAudit, parseRegister } from "../../scripts/advisories";

const REGISTER = [
  "# Advisories",
  "",
  "| Advisory | Package | Severity | Decision | Reason | Review by |",
  "|---|---|---|---|---|---|",
  "| GHSA-aaaa-aaaa-aaaa | braces | high | accepted | no fix exists | 2026-12-31 |",
  "| GHSA-bbbb-bbbb-bbbb | js-yaml | moderate | accepted | never parses YAML | 2026-11-01 |",
  "",
].join("\n");

const audit = (ids: Record<string, readonly string[]>) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(ids).map(([pkg, list]) => [
        pkg,
        list.map((id) => ({
          url: `https://github.com/advisories/${id}`,
          severity: "high",
          title: `${pkg} issue`,
        })),
      ]),
    ),
  );

describe("advisory register check (spec 012, step 2)", () => {
  it("reads one entry per advisory row of the register", () => {
    expect(parseRegister(REGISTER)).toEqual([
      { id: "GHSA-aaaa-aaaa-aaaa", pkg: "braces", reviewBy: "2026-12-31" },
      { id: "GHSA-bbbb-bbbb-bbbb", pkg: "js-yaml", reviewBy: "2026-11-01" },
    ]);
  });

  it("reads the advisory id, package and severity from bun audit --json", () => {
    expect(parseAudit(audit({ braces: ["GHSA-aaaa-aaaa-aaaa"] }))).toEqual([
      { id: "GHSA-aaaa-aaaa-aaaa", pkg: "braces", severity: "high", title: "braces issue" },
    ]);
  });

  it("passes when every reported advisory is recorded and still in date", () => {
    const found = parseAudit(audit({ braces: ["GHSA-aaaa-aaaa-aaaa"] }));
    const result = compareAdvisories(found, parseRegister(REGISTER), "2026-10-22");
    expect(result.unrecorded).toEqual([]);
    expect(result.expired).toEqual([]);
  });

  it("fails on an advisory the register does not record", () => {
    const found = parseAudit(audit({ undici: ["GHSA-cccc-cccc-cccc"] }));
    const result = compareAdvisories(found, parseRegister(REGISTER), "2026-10-22");
    expect(result.unrecorded.map((a) => a.id)).toEqual(["GHSA-cccc-cccc-cccc"]);
  });

  it("fails on a recorded advisory past its review date", () => {
    const found = parseAudit(audit({ "js-yaml": ["GHSA-bbbb-bbbb-bbbb"] }));
    const result = compareAdvisories(found, parseRegister(REGISTER), "2026-11-02");
    expect(result.expired.map((a) => a.id)).toEqual(["GHSA-bbbb-bbbb-bbbb"]);
  });

  it("still accepts an advisory on its review date", () => {
    const found = parseAudit(audit({ "js-yaml": ["GHSA-bbbb-bbbb-bbbb"] }));
    expect(compareAdvisories(found, parseRegister(REGISTER), "2026-11-01").expired).toEqual([]);
  });

  it("lists recorded advisories no longer reported, so the register can be trimmed", () => {
    const result = compareAdvisories([], parseRegister(REGISTER), "2026-10-22");
    expect(result.resolved.map((e) => e.id)).toEqual([
      "GHSA-aaaa-aaaa-aaaa",
      "GHSA-bbbb-bbbb-bbbb",
    ]);
  });

  it("refuses a register row without a valid review date", () => {
    const bad = REGISTER.replace("2026-12-31", "soon");
    expect(() => parseRegister(bad)).toThrow(/GHSA-aaaa-aaaa-aaaa.*review date/);
  });
});
