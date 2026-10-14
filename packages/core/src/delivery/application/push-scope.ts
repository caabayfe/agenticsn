import type { Catalog } from "../../metadata/domain/catalog";
import { GLOBAL } from "../domain/batch";
import { needsElevation, type PlannedWrite } from "../domain/change";
import type {
  ElevatedSession,
  ElevatedSessions,
  PushJournal,
  PushJournalStore,
  SwitchedPreference,
} from "../ports";
import { elevatedSessionFor } from "./elevated-writes";
import { settle, switchFor } from "./push-preferences";
import { type InstanceSession, moveUpdate, openChild, writeRecord } from "./push-steps";

interface ScopeRun {
  readonly deps: {
    readonly journal: PushJournalStore;
    readonly elevatedSessions: ElevatedSessions | null;
    readonly username: string;
  };
  readonly session: InstanceSession;
  readonly journal: { current: PushJournal };
  readonly catalog: Catalog;
}

interface ScopeTarget {
  readonly name: string;
  readonly id: string;
  readonly user: string;
  readonly label: string;
  // The branch's batch: global's update set, and the parent of every other scope's.
  readonly batch: { readonly sysId: string; readonly name: string; readonly created: boolean };
  readonly writes: readonly PlannedWrite[];
}

// One write, journaled before and after so an interrupted push knows what reached the instance.
async function writeStep(
  run: ScopeRun,
  write: PlannedWrite,
  target: ScopeTarget,
  through: InstanceSession,
) {
  const { deps, journal, catalog } = run;
  const save = (next: PushJournal) => {
    journal.current = next;
    return deps.journal.write(next);
  };
  const step = { operation: write.operation, table: write.table, sysId: write.sysId };
  await save({
    ...journal.current,
    steps: [...journal.current.steps, { ...step, state: "sending" }],
  });
  await writeRecord(through, catalog, write, target.id, journal.current.steps.length - 1);
  await save({
    ...journal.current,
    steps: journal.current.steps.map((s) =>
      s.sysId === write.sysId ? { ...s, state: "written" } : s,
    ),
  });
}

// The scope's update set, opened while its application is current. A new application is
// written first, as the update set can only be created in an application that exists; its
// update is then moved into the update set (ADR-0025).
async function updateSetFor(run: ScopeRun, target: ScopeTarget, application: PlannedWrite | null) {
  if (target.id === GLOBAL) {
    return { sysId: target.batch.sysId, name: target.batch.name, created: target.batch.created };
  }
  if (application !== null) {
    await writeStep(run, application, target, run.session);
  }
  const scope = { name: target.name, id: target.id };
  const set = await openChild(run.session, target.label, scope, target.batch.sysId);
  if (application !== null) {
    await moveUpdate(run.session, `sys_app_${application.sysId}`, set.sysId);
  }
  return set;
}

// Writes one scope's records into its update set: makes the scope's application current, opens
// its update set, makes that current, writes, then restores the user's preferences.
export async function pushScope(run: ScopeRun, target: ScopeTarget) {
  const { deps, session, journal } = run;
  const save = (preferences: readonly SwitchedPreference[]) => {
    journal.current = { ...journal.current, preferences };
    return deps.journal.write(journal.current);
  };
  const prefer = (name: string, value: string) =>
    switchFor(session, { user: target.user, name, value }, journal, save);
  const application =
    target.writes.find((w) => w.table === "sys_app" && w.operation === "create") ?? null;
  let elevated: ElevatedSession | null = null;
  let set: { sysId: string; name: string; created: boolean };
  try {
    await prefer("apps.current_app", target.id);
    set = await updateSetFor(run, target, application);
    // A scoped write makes the platform switch the user's global current update set too, so
    // push takes that preference as well, to put it back afterwards.
    await prefer("sys_update_set", target.id === GLOBAL ? set.sysId : target.batch.sysId);
    if (target.id !== GLOBAL) {
      await prefer(`updateSetForScope${target.id}`, set.sysId);
    }
    elevated = await elevatedSessionFor(
      deps.elevatedSessions,
      target.writes,
      deps.username,
      session.signal,
    );
    for (const write of target.writes.filter((w) => w !== application)) {
      const through =
        elevated !== null && needsElevation(write.table)
          ? { ...session, writer: elevated.writer }
          : session;
      await writeStep(run, write, target, through);
    }
  } catch (error) {
    // The write that failed is what the user needs to see; a failed restore stays journaled.
    await settle(session, elevated, journal, save).catch(() => {});
    throw error;
  }
  await settle(session, elevated, journal, save);
  return set;
}
