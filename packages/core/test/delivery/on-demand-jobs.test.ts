import { describe, expect, it } from "bun:test";
import { queueOnDemandJobs, type Row } from "@snagentic/core";
import { fakeInstance } from "../support/fake-instance";

// The demo modules' load jobs, run once as an admin's "Execute Now" runs them (ADR-0050).

const LIVE = new AbortController().signal;

const EXECUTE_NOW = { sys_id: "en", name: "Execute Now", table: "sysauto", active: "true" };

function instance(jobs: Row[], actions: Row[] = [EXECUTE_NOW]) {
  const fake = fakeInstance({ sysauto_script: jobs, sys_ui_action: actions });
  const session = { reader: fake.reader, writer: fake.reader.writer, signal: LIVE };
  return { tables: fake.tables, writes: fake.writes, session };
}

const HISTORY = { sys_id: "j1", name: "ACC demo: load history", active: "true" };

describe("on-demand jobs (ADR-0050)", () => {
  it("presses each job's Execute Now, as an admin does, and writes no trigger itself", async () => {
    const { tables, writes, session } = instance([HISTORY]);
    const result = await queueOnDemandJobs(session, ["ACC demo: load history"]);
    expect(result).toEqual({ queued: ["ACC demo: load history"], missing: [] });
    expect(writes).toEqual(["ui_action en sysauto_script j1"]);
    expect(tables["sys_trigger"] ?? []).toEqual([]);
  });

  it("names the jobs the instance lacks, and runs the others", async () => {
    const { writes, session } = instance([HISTORY]);
    const result = await queueOnDemandJobs(session, [
      "ACC demo: load scenarios",
      "ACC demo: load history",
    ]);
    expect(result).toEqual({
      queued: ["ACC demo: load history"],
      missing: ["ACC demo: load scenarios"],
    });
    expect(writes).toEqual(["ui_action en sysauto_script j1"]);
  });

  it("refuses when the instance has no Execute Now action, and runs nothing", async () => {
    const { writes, session } = instance([HISTORY], []);
    await expect(queueOnDemandJobs(session, ["ACC demo: load history"])).rejects.toThrow(
      "Execute Now",
    );
    expect(writes).toEqual([]);
  });
});
