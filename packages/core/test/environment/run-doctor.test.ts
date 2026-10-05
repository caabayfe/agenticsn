import { describe, expect, it } from "bun:test";
import { type Check, type EnvironmentProbe, runDoctor } from "@snagentic/core";

function probe(check: Check): EnvironmentProbe {
  return { name: check.name, run: async () => check };
}

const OK: Check = { name: "git", status: "ok", detail: "git version 2.54.0", hint: null };

describe("runDoctor", () => {
  it("reports ok when every check passes", async () => {
    const report = await runDoctor([probe(OK)]);
    expect(report).toEqual({ ok: true, checks: [OK] });
  });

  it("stays ok when a check is unavailable on this platform", async () => {
    const unavailable: Check = {
      name: "keychain",
      status: "unavailable",
      detail: "no Secret Service",
      hint: "use environment variables",
    };
    expect((await runDoctor([probe(OK), probe(unavailable)])).ok).toBe(true);
  });

  it("is not ok when any check fails", async () => {
    const failed: Check = { name: "git", status: "fail", detail: "not found", hint: "install git" };
    expect((await runDoctor([probe(OK), probe(failed)])).ok).toBe(false);
  });

  it("turns a probe that throws into a failed check instead of crashing", async () => {
    const broken: EnvironmentProbe = {
      name: "search-index",
      run: async () => {
        throw new Error("boom");
      },
    };
    const report = await runDoctor([broken]);
    expect(report.ok).toBe(false);
    expect(report.checks[0]).toMatchObject({
      name: "search-index",
      status: "fail",
      detail: "boom",
    });
    expect(report.checks[0]?.hint).toBeString();
  });

  it("reports checks in the order the probes were given", async () => {
    const names = ["git", "keychain", "search-index"];
    const report = await runDoctor(names.map((name) => probe({ ...OK, name })));
    expect(report.checks.map((check) => check.name)).toEqual(names);
  });
});
