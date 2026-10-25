import { readUnits } from "../../authoring/application/read-units";
import { compareUnit } from "../../authoring/domain/compare";
import type { LedgerEntry } from "../../authoring/domain/ledger";
import type { BuiltUnit, InstanceCopy } from "../../authoring/domain/unit";
import { unitSpec } from "../../authoring/domain/unit-specs";
import { GLOBAL } from "../domain/batch";
import { carrierOf } from "../domain/carried";
import { RecordChangedOnInstanceError } from "../domain/errors";
import { FlowPublishFailedError } from "../domain/fluent-errors";
import { fluentRecordOf, toPublish } from "../domain/fluent-records";
import type { PlannedUnit } from "../domain/unit-plan";
import { nextCount, stampedXml } from "../domain/unit-stamp";
import type { FluentInstaller, PushJournal, PushJournalStore, SwitchedPreference } from "../ports";
import { readRefusals } from "./load-refusals";
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
  // Why the platform skipped it during the load, as its system log says; null otherwise.
  readonly refused: string | null;
}

export interface ProjectPush {
  readonly updateSet: { readonly sysId: string; readonly name: string; readonly created: boolean };
  readonly units: readonly PushedUnit[];
  // Ledger changes: an entry per unit that now agrees with source, undefined to remove one.
  readonly ledger: ReadonlyMap<string, LedgerEntry | undefined>;
}

// Units push sends to the instance: not those only recorded or forgotten in the ledger.
const loaded = (unit: PlannedUnit) => unit.operation !== "record" && unit.operation !== "forget";

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
    if (unit.operation === "forget") {
      applied.set(unit.updateName, true);
      ledger.set(unit.updateName, undefined);
      continue;
    }
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
    const { project, updateName, table, name, operation } = unit;
    const done = loaded(unit) ? await captured(run.session, updateName, into) : true;
    const applied = back.applied.get(updateName) ?? true;
    pushed.push({
      project,
      updateName,
      table,
      name,
      operation,
      captured: done,
      applied,
      refused: null,
    });
    if (operation === "record") {
      const instance = unit.version ?? "";
      back.ledger.set(updateName, { build: unit.digest, instance, losses: unit.losses });
    }
  }
  return pushed;
}

// A label not recorded on its own is captured when the push captured its dictionary entry and
// the label reads back as built: that entry's update carries it.
function withCarried(load: ProjectLoad, pushed: readonly PushedUnit[]): PushedUnit[] {
  const loadedNow = new Map(
    pushed.filter((u) => u.operation !== "record").map((u) => [u.updateName, u]),
  );
  return pushed.map((u) => {
    if (u.captured || !u.applied || u.operation === "delete") return u;
    const built = load.built.get(u.updateName)?.unit;
    const carrier = built === undefined ? null : carrierOf(built);
    return loadedNow.get(carrier ?? "")?.captured === true ? { ...u, captured: true } : u;
  });
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

// Loaded units that neither arrived nor were recorded: the platform skipped them, and its log
// says why. A push where everything arrived reads no log.
async function withRefusals(
  run: ProjectRun,
  planned: readonly PlannedUnit[],
  pushed: readonly PushedUnit[],
  since: Date,
): Promise<PushedUnit[]> {
  const missing = pushed.filter((u) => !u.captured && !u.applied && u.operation !== "delete");
  if (missing.length === 0) return [...pushed];
  const names = new Set(missing.map((u) => u.updateName));
  const sysIds = new Set(planned.filter((u) => names.has(u.updateName)).map((u) => u.sysId));
  const reasons = await readRefusals(run.session.reader, since, sysIds, run.session.signal);
  const sysIdOf = new Map(planned.map((u) => [u.updateName, u.sysId]));
  return pushed.map((u) => {
    const reason = names.has(u.updateName)
      ? reasons.get(sysIdOf.get(u.updateName) ?? "")
      : undefined;
    return reason === undefined ? u : { ...u, refused: reason };
  });
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
    const loadedAt = run.now();
    await loadAndPublish(run, load, set.sysId, filesFor(load, units, before, loadedAt));
    const back = await readBack(run, load, units);
    const arrived = withCarried(load, await outcomes(run, units, set.sysId, back));
    const pushed = await withRefusals(run, units, arrived, loadedAt);
    await settle(session, journal, save);
    return { updateSet: set, units: pushed, ledger: back.ledger };
  } catch (error) {
    // The step that failed is what the user needs to see; a failed restore stays journaled.
    await settle(session, journal, save).catch(() => {});
    throw error;
  }
}
