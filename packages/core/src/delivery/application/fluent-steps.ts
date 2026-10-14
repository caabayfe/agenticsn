import { SESSION_USER } from "../../kernel/session-user";
import { TableName } from "../../kernel/table-name";
import { FlowDomainMismatchError, FlowPublishFailedError } from "../domain/fluent-errors";
import { holdsPublished, toPublish } from "../domain/fluent-records";
import type { FluentInstaller, FluentPackage, PushJournal, PushJournalStore } from "../ports";
import { type PlannedFluentRecord, recordsOf } from "./plan-fluent";
import type { InstanceSession } from "./push-steps";

export interface DeliveredFluentRecord {
  readonly project: string;
  readonly table: string;
  readonly sysId: string;
  readonly name: string;
  readonly kind: string;
  // The update set holds its published version (test B5).
  readonly captured: boolean;
}

export interface FluentDelivery {
  readonly records: readonly DeliveredFluentRecord[];
  // From the load, which turns a live flow into an inactive draft, until the publish
  // returned: triggers in this window are lost (test B3; accepted on development instances).
  // Null when the project redelivered no flow that already existed.
  readonly inactiveMs: number | null;
}

const rows = (session: InstanceSession, table: string, query: string, fields: string[]) =>
  session.reader.query(
    { table: TableName.parse(table), query, fields, limit: 1000 },
    session.signal,
  );

const published = (r: PlannedFluentRecord) => r.kind !== "record" && r.action !== "DELETE";

// The instance refuses to publish a flow outside its publishing user's domain (spike S11):
// checked before any write, for the flows that already exist (ADR-0028 as amended, item 7).
// Returns the flows that already exist: redelivering them makes them inactive for a while.
export async function checkFlowDomains(
  session: InstanceSession,
  username: string,
  packages: readonly FluentPackage[],
): Promise<ReadonlySet<string>> {
  const flows = packages.flatMap(recordsOf).filter((r) => r.table === "sys_hub_flow");
  if (flows.length === 0) return new Set();
  const [user] = await rows(session, "sys_user", `sys_id=${SESSION_USER}`, ["sys_domain"]);
  const domain = user?.["sys_domain"] ?? "";
  const ids = flows.map((f) => f.sysId).join(",");
  const fields = ["sys_id", "name", "sys_domain"];
  const existing = await rows(session, "sys_hub_flow", `sys_idIN${ids}`, fields);
  const elsewhere = existing.filter((flow) => (flow["sys_domain"] ?? "") !== domain);
  if (elsewhere.length > 0) {
    throw new FlowDomainMismatchError(
      username,
      domain,
      elsewhere.map((flow) => flow["name"] ?? ""),
    );
  }
  return new Set(existing.map((flow) => flow["sys_id"] ?? ""));
}

interface FluentRun {
  readonly session: InstanceSession;
  readonly installer: FluentInstaller;
  readonly journal: { current: PushJournal };
  readonly store: PushJournalStore;
  readonly now: () => Date;
  // Flows that existed before this push (checkFlowDomains).
  readonly live: ReadonlySet<string>;
}

async function journaled(run: FluentRun, project: string, state: "sending" | "written") {
  const step = { operation: "fluent-load", table: "sys_hub_flow", sysId: project };
  const others = run.journal.current.steps.filter((s) => s.sysId !== project);
  run.journal.current = { ...run.journal.current, steps: [...others, { ...step, state }] };
  await run.store.write(run.journal.current);
}

async function capturedIn(run: FluentRun, record: PlannedFluentRecord, updateSet: string) {
  const query = `name=${record.updateName}^update_set=${updateSet}`;
  const [update] = await rows(run.session, "sys_update_xml", query, ["payload"]);
  return update !== undefined && holdsPublished(record, update["payload"] ?? "");
}

// Loads a Fluent project's build into the scope's update set, publishes its flows and actions
// right after, and checks that the update set holds their published versions (ADR-0028 as
// amended, items 2 and 3). The user's preferences already name that update set.
export async function deliverFluent(
  run: FluentRun,
  fluentPackage: FluentPackage,
  updateSet: string,
): Promise<FluentDelivery> {
  const records = recordsOf(fluentPackage);
  await journaled(run, fluentPackage.project, "sending");
  const started = run.now().getTime();
  const { session } = run;
  await run.installer.load(fluentPackage.scopeId, fluentPackage.files, updateSet, session.signal);
  await journaled(run, fluentPackage.project, "written");
  const results = await run.installer.publish(
    fluentPackage.scope,
    toPublish(records),
    session.signal,
  );
  const redelivered = records.some((r) => run.live.has(r.sysId));
  const inactiveMs = redelivered ? run.now().getTime() - started : null;
  const failed = results.filter((result) => !result.published);
  if (failed.length > 0) {
    const name = (id: string) => records.find((r) => r.sysId === id)?.name ?? id;
    throw new FlowPublishFailedError(
      failed.map((f) => ({ name: name(f.sysId), message: f.message })),
    );
  }
  const delivered: DeliveredFluentRecord[] = [];
  for (const record of records.filter(published)) {
    const { project, table, sysId, name, kind } = record;
    const captured = await capturedIn(run, record, updateSet);
    delivered.push({ project, table, sysId, name, kind, captured });
  }
  return { records: delivered, inactiveMs };
}
