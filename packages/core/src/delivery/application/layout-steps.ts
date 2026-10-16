import { TableName } from "../../kernel/table-name";
import { RecordChangedOnInstanceError } from "../domain/errors";
import { layoutVersion, type PlannedLayout } from "../domain/layout-changes";
import { KIND_TABLE, layoutKindOf } from "../domain/layout-kinds";
import { layoutStamp, layoutXml } from "../domain/layout-render";
import type { FluentInstaller, PushJournal, PushJournalStore } from "../ports";
import { captured, type InstanceSession, updateVersions } from "./push-steps";

export interface LoadRun {
  readonly session: InstanceSession;
  readonly installer: FluentInstaller;
  readonly journal: { current: PushJournal };
  readonly store: PushJournalStore;
}

export interface LoadTarget {
  readonly scope: { readonly name: string; readonly id: string };
  readonly updateSet: string;
  readonly username: string;
  // The push's time, stamped on the loaded record (ADR-0030).
  readonly now: Date;
}

const versions = async (session: InstanceSession, table: string, query: string) => {
  const rows = await session.reader.query(
    {
      table: TableName.parse(table),
      query,
      fields: ["sys_id", "sys_mod_count", "sys_updated_on"],
      limit: 1000,
    },
    session.signal,
  );
  return new Map(rows.map((row) => [row["sys_id"] ?? "", layoutVersion(row)]));
};

// The instance's record and rows are as they were pulled: a new layout does not exist yet, and an
// edited one has the same rows at the same versions (ADR-0029, item 4).
async function unchangedSincePull(session: InstanceSession, layout: PlannedLayout) {
  const table = KIND_TABLE[layout.kind];
  const current = (await versions(session, table, `sys_id=${layout.sysId}`)).get(layout.sysId);
  if (layout.base === null) {
    return current === undefined;
  }
  const spec = layoutKindOf(table);
  if (current !== layout.base.record || spec === undefined) {
    return false;
  }
  const rows = await versions(session, spec.rows, `${spec.parentField}=${layout.sysId}`);
  const pulled = Object.entries(layout.base.rows);
  return rows.size === pulled.length && pulled.every(([sysId, v]) => rows.get(sysId) === v);
}

async function journaled(
  run: LoadRun,
  step: { table: string; sysId: string },
  state: "sending" | "written",
) {
  const entry = { operation: "load", ...step };
  const others = run.journal.current.steps.filter((s) => s.sysId !== step.sysId);
  run.journal.current = { ...run.journal.current, steps: [...others, { ...entry, state }] };
  await run.store.write(run.journal.current);
}

// Loads one update into the scope's update set through fluent/load, journaled before and after,
// then reports whether the update set recorded it under `updateName`. Never retried (ADR-0016).
export async function loadUpdate(
  run: LoadRun,
  update: {
    readonly table: string;
    readonly sysId: string;
    readonly updateName: string;
    readonly xml: string;
  },
  target: LoadTarget,
): Promise<boolean> {
  const step = { table: update.table, sysId: update.sysId };
  const before = await updateVersions(run.session, update.updateName);
  await journaled(run, step, "sending");
  const file = { name: `${update.updateName}.xml`, content: update.xml };
  await run.installer.load(target.scope.id, [file], target.updateSet, run.session.signal);
  await journaled(run, step, "written");
  const record = {
    table: update.table,
    sysId: update.sysId,
    owner: null,
    updateName: update.updateName,
  };
  const into = { updateSet: target.updateSet, username: target.username };
  return captured(run.session, record, into, before);
}

// Refuses the scope's layouts when one moved on the instance since the pull. Checked before the
// scope's first write: loading a new form section makes the platform add it to its form (pdi2),
// so a check made between loads would find the push's own change.
export async function ensureLayoutsUnchanged(
  session: InstanceSession,
  layouts: readonly PlannedLayout[],
  written: number,
): Promise<void> {
  for (const layout of layouts) {
    if (!(await unchangedSincePull(session, layout))) {
      throw new RecordChangedOnInstanceError(layout.path, written);
    }
  }
}

// Loads one layout whole, as the update the platform records for it (ADR-0029, ADR-0030), once
// ensureLayoutsUnchanged has passed.
export async function deliverLayout(
  run: LoadRun,
  layout: PlannedLayout,
  target: LoadTarget,
): Promise<boolean> {
  const scope = { name: target.scope.name, sysId: target.scope.id };
  return loadUpdate(
    run,
    {
      table: KIND_TABLE[layout.kind],
      sysId: layout.sysId,
      updateName: layout.updateName,
      xml: layoutXml(layout, scope, layoutStamp(layout, target.now)),
    },
    target,
  );
}
