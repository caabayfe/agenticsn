import { TableName } from "../../kernel/table-name";
import { OnDemandJobsUnavailableError } from "../domain/errors";
import type { InstanceSession } from "./push-steps";

// Runs scheduled jobs once, now, as an admin's "Execute Now" does (ADR-0050): a run-once trigger
// on the job, for the instance's scheduler to pick up. A trigger is not captured in update sets.

// The platform's runner for scheduled script jobs (sysauto_script).
const RUNNER = "RunScriptJob";

export interface QueuedJobs {
  // The jobs queued, and those the instance does not have (their module is not installed).
  readonly queued: readonly string[];
  readonly missing: readonly string[];
}

// The trigger's time, in the instance's internal format (UTC).
const internalTime = (at: Date) => at.toISOString().slice(0, 19).replace("T", " ");

async function rows(session: InstanceSession, table: string, query: string, limit: number) {
  return session.reader.query(
    { table: TableName.parse(table), query, fields: ["sys_id", "name"], limit },
    session.signal,
  );
}

export async function queueOnDemandJobs(
  session: InstanceSession,
  names: readonly string[],
  now: Date,
): Promise<QueuedJobs> {
  const [runner] = await rows(session, "sys_job", `name=${RUNNER}`, 1);
  if (runner === undefined) throw new OnDemandJobsUnavailableError(RUNNER);
  const jobs = await rows(session, "sysauto_script", `nameIN${names.join(",")}`, names.length);
  const queued: string[] = [];
  for (const name of names) {
    const job = jobs.find((row) => row["name"] === name);
    if (job === undefined) continue;
    await session.writer.insert(
      "sys_trigger",
      {
        name,
        document: "sysauto_script",
        document_key: job["sys_id"] ?? "",
        job_id: runner["sys_id"] ?? "",
        trigger_type: "0",
        state: "0",
        next_action: internalTime(now),
      },
      session.signal,
    );
    queued.push(name);
  }
  return { queued, missing: names.filter((name) => !queued.includes(name)) };
}
