import { TableName } from "../../kernel/table-name";
import { OnDemandJobsUnavailableError } from "../domain/errors";
import type { InstanceSession } from "./push-steps";

// Runs scheduled jobs once, now, by pressing their "Execute Now" button (ADR-0050): the platform's
// own action queues the run for the scheduler, with a trigger it writes in full. A trigger written
// through the Table API lost its name, document and type to field ACLs, and never ran (everis2,
// 2026-11-04). The action leaves the job record as it is.

// The platform's action on every scheduled job (sysauto), and the jobs' table.
const EXECUTE_NOW = "Execute Now";
const JOBS = "sysauto_script";

export interface QueuedJobs {
  // The jobs queued, and those the instance does not have (their module is not installed).
  readonly queued: readonly string[];
  readonly missing: readonly string[];
}

async function rows(session: InstanceSession, table: string, query: string, limit: number) {
  return session.reader.query(
    { table: TableName.parse(table), query, fields: ["sys_id", "name"], limit },
    session.signal,
  );
}

export async function queueOnDemandJobs(
  session: InstanceSession,
  names: readonly string[],
): Promise<QueuedJobs> {
  const [action] = await rows(
    session,
    "sys_ui_action",
    `name=${EXECUTE_NOW}^table=sysauto^active=true`,
    1,
  );
  if (action === undefined) throw new OnDemandJobsUnavailableError(EXECUTE_NOW);
  const jobs = await rows(session, JOBS, `nameIN${names.join(",")}`, names.length);
  const queued: string[] = [];
  for (const name of names) {
    const job = jobs.find((row) => row["name"] === name);
    if (job === undefined) continue;
    await session.writer.uiAction(
      action["sys_id"] ?? "",
      JOBS,
      job["sys_id"] ?? "",
      session.signal,
    );
    queued.push(name);
  }
  return { queued, missing: names.filter((name) => !queued.includes(name)) };
}
