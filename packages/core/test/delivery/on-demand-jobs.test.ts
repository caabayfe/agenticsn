import { describe, expect, it } from "bun:test";
import { queueOnDemandJobs, type Row } from "@snagentic/core";
import { fakeInstance } from "../support/fake-instance";

// The demo modules' load jobs, run once as an admin's "Execute Now" runs them (ADR-0050).

const LIVE = new AbortController().signal;
const NOW = new Date("2026-11-04T10:15:30.000Z");

function instance(jobs: Row[], runner: Row[] = [{ sys_id: "rsj", name: "RunScriptJob" }]) {
  const fake = fakeInstance({ sysauto_script: jobs, sys_job: runner });
  const session = { reader: fake.reader, writer: fake.reader.writer, signal: LIVE };
  return { tables: fake.tables, session };
}

const HISTORY = { sys_id: "j1", name: "ACC demo: load history", active: "true" };

describe("on-demand jobs (ADR-0050)", () => {
  it("queues each job to run now, as Execute Now does", async () => {
    const { tables, session } = instance([HISTORY]);
    const result = await queueOnDemandJobs(session, ["ACC demo: load history"], NOW);
    expect(result).toEqual({ queued: ["ACC demo: load history"], missing: [] });
    const triggers = (tables["sys_trigger"] ?? []).map(
      ({ name, document, document_key, job_id, trigger_type, state, next_action }) => ({
        name,
        document,
        document_key,
        job_id,
        trigger_type,
        state,
        next_action,
      }),
    );
    expect(triggers).toEqual([
      {
        name: "ACC demo: load history",
        document: "sysauto_script",
        document_key: "j1",
        job_id: "rsj",
        trigger_type: "0",
        state: "0",
        next_action: "2026-11-04 10:15:30",
      },
    ]);
  });

  it("names the jobs the instance lacks, and queues the others", async () => {
    const { tables, session } = instance([HISTORY]);
    const result = await queueOnDemandJobs(
      session,
      ["ACC demo: load scenarios", "ACC demo: load history"],
      NOW,
    );
    expect(result).toEqual({
      queued: ["ACC demo: load history"],
      missing: ["ACC demo: load scenarios"],
    });
    expect(tables["sys_trigger"]?.length).toBe(1);
  });

  it("refuses when the instance has no job runner, and queues nothing", async () => {
    const { tables, session } = instance([HISTORY], []);
    await expect(queueOnDemandJobs(session, ["ACC demo: load history"], NOW)).rejects.toThrow(
      "RunScriptJob",
    );
    expect(tables["sys_trigger"] ?? []).toEqual([]);
  });
});
