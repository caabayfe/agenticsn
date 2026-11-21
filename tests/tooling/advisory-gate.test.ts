import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseRegister } from "../../scripts/advisories";
import { advisoryGate } from "../../scripts/advisory-gate";
import { parseLockfile } from "../../scripts/lockfile";

const ROOT = join(import.meta.dir, "../..");
const FIXTURES = join(import.meta.dir, "../fixtures/advisories");
const LOCK = parseLockfile(readFileSync(join(FIXTURES, "lockfile.jsonc"), "utf8"));
// `bun audit --json` output with two advisories: fast-uri (two ranges) and zod.
const AUDIT = readFileSync(join(FIXTURES, "audit.json"), "utf8");

const HEADER = [
  "| Advisory | Package | Versions | Through | Severity | Decision | Reason | Review by |",
  "|---|---|---|---|---|---|---|---|",
];
const FAST_URI =
  "| GHSA-w74x-v6f9-j3xg | fast-uri | 3.1.8, 4.2.2 | `@vendor/sdk`, `mcp` | moderate | accepted | a reason | 2026-12-31 |";
const ZOD =
  "| GHSA-mrhx-c7xc-m3w5 | zod | 4.6.5 | @vendor/sdk | high | accepted | a reason | 2026-12-31 |";
const register = (...rows: readonly string[]) => parseRegister([...HEADER, ...rows, ""].join("\n"));
const gate = (exitCode: number | null, stdout: string, ...rows: readonly string[]) =>
  advisoryGate({ exitCode, stdout }, LOCK, register(...rows), "2026-11-21");

describe("the advisory gate (SEC3-07)", () => {
  it("passes on a report without advisories", () => {
    expect(gate(0, "{}\n")).toMatchObject({ kind: "checked", failed: false });
  });

  it("passes when every reported advisory has a decision in date", () => {
    // `bun audit` exits non-zero whenever it reports anything.
    expect(gate(1, AUDIT, FAST_URI, ZOD)).toMatchObject({ kind: "checked", failed: false });
  });

  it("fails on a reported advisory without a decision, and names it", () => {
    const outcome = gate(1, AUDIT, FAST_URI);
    expect(outcome).toMatchObject({ kind: "checked", failed: true });
    expect(outcome.kind === "checked" && outcome.comparison.unrecorded.map((a) => a.id)).toEqual([
      "GHSA-mrhx-c7xc-m3w5",
    ]);
  });

  it("fails as not run when the audit printed nothing", () => {
    expect(gate(1, "", FAST_URI, ZOD)).toEqual({
      kind: "not-run",
      reason: "bun audit exited with 1 and printed no report",
    });
    expect(gate(0, "  \n")).toMatchObject({ kind: "not-run" });
  });

  it("fails as not run when the output is not a report", () => {
    expect(gate(0, "error: ConnectionRefused")).toEqual({
      kind: "not-run",
      reason: "bun audit's output is not JSON",
    });
    for (const output of ["[]", "null", '"{}"', '{"error":"registry unavailable"}']) {
      expect(gate(0, output)).toEqual({
        kind: "not-run",
        reason: "bun audit's output is not a report (packages mapped to their advisories)",
      });
    }
  });

  it("fails as not run when the audit failed without reporting an advisory", () => {
    expect(gate(1, "{}")).toEqual({
      kind: "not-run",
      reason: "bun audit exited with 1 and reported no advisory",
    });
    expect(gate(null, "{}")).toMatchObject({
      kind: "not-run",
      reason: "bun audit was stopped by a signal and reported no advisory",
    });
  });

  it("never reads a failed audit as accepted advisories only", () => {
    expect(gate(1, "", FAST_URI, ZOD).kind).toBe("not-run");
  });
});

describe("the release workflow (SEC3-07)", () => {
  const release = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
  const weekly = readFileSync(join(ROOT, ".github/workflows/advisories.yml"), "utf8");
  const STEP = "run: bun scripts/check-advisories.ts";

  it("runs the advisory gate as the scheduled workflow does", () => {
    expect(weekly).toContain(STEP);
    expect(release).toContain(STEP);
  });

  it("runs it in the job every binary and the publication wait for", () => {
    const check = release.slice(release.indexOf("\n  check:"), release.indexOf("\n  binary:"));
    expect(check).toContain(STEP);
    expect(release).toMatch(/\n {2}binary:\n {4}needs: check\n/);
    expect(release).toMatch(/\n {2}publish:\n {4}needs: binary\n/);
  });
});
