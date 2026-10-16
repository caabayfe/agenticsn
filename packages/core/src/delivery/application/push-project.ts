import { readUnits } from "../../authoring/application/read-units";
import { compareUnit } from "../../authoring/domain/compare";
import type { LedgerEntry } from "../../authoring/domain/ledger";
import type { BuiltUnit, InstanceCopy } from "../../authoring/domain/unit";
import { unitSpec } from "../../authoring/domain/unit-specs";
import { GLOBAL } from "../domain/batch";
import { RecordChangedOnInstanceError } from "../domain/errors";
import { FlowPublishFailedError } from "../domain/fluent-errors";
import { fluentRecordOf, toPublish } from "../domain/fluent-records";
import type { PlannedUnit } from "../domain/unit-plan";
import { nextCount, stampedXml } from "../domain/unit-stamp";
import type { FluentInstaller, PushJournal, PushJournalStore, SwitchedPreference } from "../ports";
import type { ProjectLoad } from "./plan-units";
import { settle, switchFor } from "./push-preferences";
import { captured, type InstanceSession, openChild } from "./push-steps";

// One project's push (ADR-0031 item 4): its application made current, its update set opened,
// every planned unit checked against the version the plan saw, then one fluent/load of the
// stamped files, flows published, capture checked, and each unit read back.

export interface ProjectRun {
  readonly session: InstanceSession;
  readonly installer: FluentInstaller;
  readonly journal: { current: PushJournal };
  readonly store: PushJournalStore;
  readonly username: string;
  readonly user: string;
  readonly label: string;
  readonly batch: { readonly sysId: string; readonly name: string; readonly created: boolean };
  readonly now: () => Date;
}

export interface PushedUnit {
  readonly project: string;
  readonly updateName: string;
  readonly table: string;
  readonly name: string;
  readonly operation: PlannedUnit["operation"];
  // Recorded in the scope's update set under its update name.
  readonly captured: boolean;
  // Read back, the instance holds what the build loaded.
  readonly applied: boolean;
}

export interface ProjectPush {
  readonly updateSet: { readonly sysId: string; readonly name: string; readonly created: boolean };
  readonly units: readonly PushedUnit[];
  // Ledger changes: an entry per unit that now agrees with source, undefined to remove one.
  readonly ledger: ReadonlyMap<string, LedgerEntry | undefined>;
}

const loaded = (unit: PlannedUnit) => unit.operation !== "record";

// Refuses when any unit moved on the instance since the plan read it.
function ensureUnmoved(
  units: readonly PlannedUnit[],
  copies: ReadonlyMap<string, InstanceCopy | null>,
  written: number,
): void {
  for (const unit of units.filter(loaded)) {
    const now = copies.get(unit.updateName)?.version ?? null;
    if (now !== unit.version) throw new RecordChangedOnInstanceError(unit.updateName, written);
  }
}

// The files one load sends: each planned unit's build, its head stamped as a save would.
function filesFor(
  load: ProjectLoad,
  units: readonly PlannedUnit[],
  copies: ReadonlyMap<string, InstanceCopy | null>,
  now: Date,
) {
  return units.filter(loaded).map((unit) => {
    const built = load.built.get(unit.updateName);
    const xml = built?.xml ?? "";
    const count = copies.get(unit.updateName)?.head["sys_mod_count"];
    const content =
      unit.operation === "delete" ? xml : stampedXml(xml, unit.table, nextCount(count), now);
    return { name: unit.file.slice(unit.file.lastIndexOf("/") + 1), content };
  });
}

async function journaled(run: ProjectRun, project: string, state: "sending" | "written") {
  const step = { operation: "load", table: "source", sysId: project };
  const others = run.journal.current.steps.filter((s) => s.sysId !== project);
  run.journal.current = { ...run.journal.current, steps: [...others, { ...step, state }] };
  await run.store.write(run.journal.current);
}

// Flows and actions are published after their load: the platform records the published
// version, compiled (ADR-0028 as amended).
async function publish(run: ProjectRun, scope: string, files: readonly { content: string }[]) {
  const records = files.flatMap((file) => fluentRecordOf(file.content) ?? []);
  const targets = toPublish(records);
  if (targets.flows.length + targets.actions.length === 0) return;
  const results = await run.installer.publish(scope, targets, run.session.signal);
  const failed = results.filter((result) => !result.published);
  if (failed.length > 0) {
    const name = (id: string) => records.find((r) => r.sysId === id)?.name ?? id;
    throw new FlowPublishFailedError(
      failed.map((f) => ({ name: name(f.sysId), message: f.message })),
    );
  }
}

// What the instance holds after the load, unit by unit, and the ledger it makes.
async function readBack(run: ProjectRun, load: ProjectLoad, units: readonly PlannedUnit[]) {
  const built = units.flatMap((u) => load.built.get(u.updateName)?.unit ?? []);
  const copies = await readUnits(run.session.reader, built, run.session.signal);
  const ledger = new Map<string, LedgerEntry | undefined>();
  const applied = new Map<string, boolean>();
  for (const unit of units) {
    const copy = copies.get(unit.updateName) ?? null;
    const builtUnit = load.built.get(unit.updateName)?.unit;
    if (unit.operation === "delete") {
      applied.set(unit.updateName, copy === null);
      if (copy === null && unit.removes !== null) ledger.set(unit.removes, undefined);
      continue;
    }
    const same = copy !== null && builtUnit !== undefined && agrees(builtUnit, copy);
    applied.set(unit.updateName, same);
    if (same)
      ledger.set(unit.updateName, {
        build: unit.digest,
        instance: copy.version,
        losses: unit.losses,
      });
  }
  return { ledger, applied };
}

const agrees = (unit: BuiltUnit, copy: InstanceCopy) =>
  !unitSpec(unit.head.table).comparable || compareUnit(unit, copy).length === 0;

async function openSet(run: ProjectRun, load: ProjectLoad) {
  const { project } = load;
  if (project.scopeId === GLOBAL) return run.batch;
  return openChild(
    run.session,
    run.label,
    { name: project.scope, id: project.scopeId },
    run.batch.sysId,
  );
}

// Each unit's outcome: captured in the update set, and applied as built. Units the instance
// already held are recorded in the ledger as they were read at plan time.
async function outcomes(
  run: ProjectRun,
  units: readonly PlannedUnit[],
  updateSet: string,
  back: Awaited<ReturnType<typeof readBack>>,
): Promise<PushedUnit[]> {
  const pushed: PushedUnit[] = [];
  const into = { updateSet, username: run.username };
  for (const unit of units) {
    const { project, updateName, table, sysId, name, operation } = unit;
    const record = { table, sysId, owner: null, updateName };
    const done = loaded(unit) ? await captured(run.session, record, into) : true;
    const applied = back.applied.get(updateName) ?? true;
    pushed.push({ project, updateName, table, name, operation, captured: done, applied });
    if (operation === "record") {
      const instance = unit.version ?? "";
      back.ledger.set(updateName, { build: unit.digest, instance, losses: unit.losses });
    }
  }
  return pushed;
}

// Loads the project's files, then publishes the flows among them.
async function loadAndPublish(
  run: ProjectRun,
  load: ProjectLoad,
  updateSet: string,
  files: readonly { name: string; content: string }[],
) {
  if (files.length === 0) return;
  await journaled(run, load.project.path, "sending");
  await run.installer.load(load.project.scopeId, files, updateSet, run.session.signal);
  await journaled(run, load.project.path, "written");
  await publish(run, load.project.scope, files);
}

export async function pushProject(run: ProjectRun, load: ProjectLoad): Promise<ProjectPush> {
  const { session, journal } = run;
  const save = (preferences: readonly SwitchedPreference[]) => {
    journal.current = { ...journal.current, preferences };
    return run.store.write(journal.current);
  };
  const prefer = (name: string, value: string) =>
    switchFor(session, { user: run.user, name, value }, journal, save);
  const { units, project } = load;
  try {
    const built = units.flatMap((u) => load.built.get(u.updateName)?.unit ?? []);
    const before = await readUnits(session.reader, built, session.signal);
    ensureUnmoved(units, before, journal.current.steps.length);
    await prefer("apps.current_app", project.scopeId);
    const set = await openSet(run, load);
    // A scoped write makes the platform switch the user's global current update set too, so
    // push takes that preference as well, to put it back afterwards.
    await prefer("sys_update_set", project.scopeId === GLOBAL ? set.sysId : run.batch.sysId);
    if (project.scopeId !== GLOBAL) await prefer(`updateSetForScope${project.scopeId}`, set.sysId);
    await loadAndPublish(run, load, set.sysId, filesFor(load, units, before, run.now()));
    const back = await readBack(run, load, units);
    const pushed = await outcomes(run, units, set.sysId, back);
    await settle(session, null, journal, save);
    return { updateSet: set, units: pushed, ledger: back.ledger };
  } catch (error) {
    // The step that failed is what the user needs to see; a failed restore stays journaled.
    await settle(session, null, journal, save).catch(() => {});
    throw error;
  }
}
