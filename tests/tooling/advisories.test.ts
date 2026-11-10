import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Advisory,
  compareAdvisories,
  findingsOf,
  parseAudit,
  parseRegister,
} from "../../scripts/advisories";
import { copiesOf, parseLockfile } from "../../scripts/lockfile";

const FIXTURES = join(import.meta.dir, "../fixtures/advisories");
// A small bun.lock: a vendor SDK pins zod 4.6.5 and brings fast-uri 4 and (through ajv 8) 3; an
// MCP package brings ajv 8 too; a lint tool's ajv 6 brings no fast-uri at all.
const LOCK = parseLockfile(readFileSync(join(FIXTURES, "lockfile.jsonc"), "utf8"));
// Trimmed `bun audit --json` output (2026-11-10): one fast-uri advisory, reported once per major.
const AUDIT = readFileSync(join(FIXTURES, "audit.json"), "utf8");

const HEADER = [
  "| Advisory | Package | Versions | Through | Severity | Decision | Reason | Review by |",
  "|---|---|---|---|---|---|---|---|",
];
const row = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;
const FAST_URI = ["GHSA-w74x-v6f9-j3xg", "fast-uri", "3.1.8, 4.2.2", "`@vendor/sdk`, `mcp`"];
const ZOD = ["GHSA-mrhx-c7xc-m3w5", "zod", "4.6.5", "@vendor/sdk"];
const DECISION = ["moderate", "accepted", "a reason"];
const register = (...rows: readonly (readonly string[])[]) =>
  parseRegister(["# Advisories", "", ...HEADER, ...rows.map((cells) => row(cells)), ""].join("\n"));
const both = (fastUriDate: string, zodDate: string) =>
  register([...FAST_URI, ...DECISION, fastUriDate], [...ZOD, ...DECISION, zodDate]);
const withFastUri = (...zodRow: readonly string[]) =>
  register([...FAST_URI, ...DECISION, "2026-12-31"], [...zodRow, ...DECISION, "2026-12-31"]);

const findings = () => findingsOf(parseAudit(AUDIT), LOCK);

describe("installed copies from bun.lock (spec 014, F2)", () => {
  it("names every installed copy of a package and the direct dependencies that bring it in", () => {
    expect(copiesOf(LOCK, "fast-uri")).toEqual([
      { version: "3.1.8", through: ["@vendor/sdk", "mcp"] },
      { version: "4.2.2", through: ["@vendor/sdk"] },
    ]);
  });

  it("resolves a dependency to the copy nested under its dependent first", () => {
    expect(copiesOf(LOCK, "zod")).toEqual([
      { version: "4.6.5", through: ["@vendor/sdk"] },
      { version: "4.6.7", through: ["mcp", "zod"] },
    ]);
  });

  it("does not follow a path the lockfile does not have", () => {
    expect(copiesOf(LOCK, "uri-js")).toEqual([{ version: "4.4.1", through: ["lint"] }]);
  });
});

describe("advisory register check (spec 012 step 2, spec 014 F2)", () => {
  it("reads the advisory id, package, severity and vulnerable range from bun audit --json", () => {
    expect(parseAudit(AUDIT).at(-1)).toEqual({
      id: "GHSA-mrhx-c7xc-m3w5",
      pkg: "zod",
      severity: "high",
      title: "Zod can exhaust memory while validating oversized constrained collections",
      vulnerable: "<4.6.6",
    });
  });

  it("reports each advisory once, with the installed versions it hits and how they arrive", () => {
    expect(findings()).toEqual([
      expect.objectContaining({
        id: "GHSA-w74x-v6f9-j3xg",
        pkg: "fast-uri",
        versions: ["3.1.8", "4.2.2"],
        through: ["@vendor/sdk", "mcp"],
      }),
      expect.objectContaining({
        id: "GHSA-mrhx-c7xc-m3w5",
        pkg: "zod",
        versions: ["4.6.5"],
        through: ["@vendor/sdk"],
      }),
    ]);
  });

  it("reads each row's versions and paths, ignoring code marks", () => {
    expect(register([...FAST_URI, ...DECISION, "2026-12-31"])).toEqual([
      {
        id: "GHSA-w74x-v6f9-j3xg",
        pkg: "fast-uri",
        versions: ["3.1.8", "4.2.2"],
        through: ["@vendor/sdk", "mcp"],
        reviewBy: "2026-12-31",
      },
    ]);
  });

  it("passes when every advisory is recorded for the versions and paths it hits, in date", () => {
    const result = compareAdvisories(findings(), both("2026-12-31", "2026-12-31"), "2026-11-10");
    expect(result).toEqual({
      unrecorded: [],
      changed: [],
      expired: [],
      resolved: [],
      narrower: [],
    });
  });

  it("fails on an advisory the register does not record", () => {
    const rows = register([...FAST_URI, ...DECISION, "2026-12-31"]);
    const result = compareAdvisories(findings(), rows, "2026-11-10");
    expect(result.unrecorded.map((a) => a.id)).toEqual(["GHSA-mrhx-c7xc-m3w5"]);
  });

  it("fails on a decision recorded for another version, naming the version that changed", () => {
    const rows = withFastUri("GHSA-mrhx-c7xc-m3w5", "zod", "3.23.8", "@vendor/sdk");
    const result = compareAdvisories(findings(), rows, "2026-11-10");
    expect(result.changed).toEqual([
      expect.objectContaining({ id: "GHSA-mrhx-c7xc-m3w5", versions: ["4.6.5"], through: [] }),
    ]);
  });

  it("fails when an advisory reaches snagentic through a path the decision does not name", () => {
    const sdkOnly = ["GHSA-w74x-v6f9-j3xg", "fast-uri", "3.1.8, 4.2.2", "@vendor/sdk"];
    const rows = register(
      [...sdkOnly, ...DECISION, "2026-12-31"],
      [...ZOD, ...DECISION, "2026-12-31"],
    );
    const result = compareAdvisories(findings(), rows, "2026-11-10");
    expect(result.changed).toEqual([
      expect.objectContaining({ id: "GHSA-w74x-v6f9-j3xg", versions: [], through: ["mcp"] }),
    ]);
  });

  it("only notes a decision that covers more than is still reported, so it can be narrowed", () => {
    const rows = withFastUri("GHSA-mrhx-c7xc-m3w5", "zod", "4.6.4, 4.6.5", "@vendor/sdk, other");
    const result = compareAdvisories(findings(), rows, "2026-11-10");
    expect(result.changed).toEqual([]);
    expect(result.narrower).toEqual([
      expect.objectContaining({
        id: "GHSA-mrhx-c7xc-m3w5",
        versions: ["4.6.4"],
        through: ["other"],
      }),
    ]);
  });

  it("fails on a recorded advisory past its review date", () => {
    const result = compareAdvisories(findings(), both("2026-12-31", "2026-11-01"), "2026-11-02");
    expect(result.expired.map((a) => a.id)).toEqual(["GHSA-mrhx-c7xc-m3w5"]);
  });

  it("still accepts an advisory on its review date", () => {
    const result = compareAdvisories(findings(), both("2026-11-01", "2026-11-01"), "2026-11-01");
    expect(result.expired).toEqual([]);
  });

  it("lists recorded advisories no longer reported, so the register can be trimmed", () => {
    const fastUriOnly: Advisory[] = parseAudit(AUDIT).filter((a) => a.pkg === "fast-uri");
    const rows = both("2026-12-31", "2026-12-31");
    const result = compareAdvisories(findingsOf(fastUriOnly, LOCK), rows, "2026-11-10");
    expect(result.resolved.map((e) => e.id)).toEqual(["GHSA-mrhx-c7xc-m3w5"]);
  });

  it("refuses a register row without a valid review date", () => {
    expect(() => register([...ZOD, ...DECISION, "soon"])).toThrow(
      /GHSA-mrhx-c7xc-m3w5.*review date/,
    );
  });

  it("refuses a register row that names no installed version", () => {
    const blank = ["GHSA-mrhx-c7xc-m3w5", "zod", "", "@vendor/sdk"];
    expect(() => register([...blank, ...DECISION, "2026-12-31"])).toThrow(
      /GHSA-mrhx-c7xc-m3w5.*versions/,
    );
  });
});
