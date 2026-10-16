import { TableName } from "../../kernel/table-name";
import { RecordChangedOnInstanceError } from "../domain/errors";
import { listVersion, type PlannedList } from "../domain/list-changes";
import { listLayoutXml, listUpdateName } from "../domain/list-layout";
import type { FluentInstaller, PushJournal, PushJournalStore } from "../ports";
import { captured, type InstanceSession } from "./push-steps";

export interface ListRun {
  readonly session: InstanceSession;
  readonly installer: FluentInstaller;
  readonly journal: { current: PushJournal };
  readonly store: PushJournalStore;
}

export interface ListTarget {
  readonly scope: { readonly name: string; readonly id: string };
  readonly updateSet: string;
  readonly username: string;
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
  return new Map(rows.map((row) => [row["sys_id"] ?? "", listVersion(row)]));
};

// The instance's list and columns are as they were pulled: a new list does not exist yet, and an
// edited one has the same columns at the same versions (ADR-0029, item 4).
async function unchangedSincePull(session: InstanceSession, list: PlannedList) {
  const id = list.layout.sysId;
  const current = (await versions(session, "sys_ui_list", `sys_id=${id}`)).get(id);
  if (list.base === null) {
    return current === undefined;
  }
  if (current !== list.base.list) {
    return false;
  }
  const columns = await versions(session, "sys_ui_list_element", `list_id=${id}`);
  const pulled = Object.entries(list.base.columns);
  return columns.size === pulled.length && pulled.every(([sysId, v]) => columns.get(sysId) === v);
}

async function journaled(run: ListRun, list: PlannedList, state: "sending" | "written") {
  const step = { operation: "list-load", table: "sys_ui_list", sysId: list.layout.sysId };
  const others = run.journal.current.steps.filter((s) => s.sysId !== step.sysId);
  run.journal.current = { ...run.journal.current, steps: [...others, { ...step, state }] };
  await run.store.write(run.journal.current);
}

// Loads one list whole, as the platform's List Layout update, into the scope's update set, and
// reports whether the update set recorded it (ADR-0029). Never retried (ADR-0016).
export async function deliverList(
  run: ListRun,
  list: PlannedList,
  target: ListTarget,
): Promise<boolean> {
  const { session } = run;
  if (!(await unchangedSincePull(session, list))) {
    throw new RecordChangedOnInstanceError(list.path, run.journal.current.steps.length);
  }
  await journaled(run, list, "sending");
  const file = {
    name: `${listUpdateName(list.layout)}.xml`,
    content: listLayoutXml(list.layout, { name: target.scope.name, sysId: target.scope.id }),
  };
  await run.installer.load(target.scope.id, [file], target.updateSet, session.signal);
  await journaled(run, list, "written");
  const record = { table: "sys_ui_list", sysId: list.layout.sysId, owner: null, updateName: null };
  return captured(session, record, { updateSet: target.updateSet, username: target.username });
}
