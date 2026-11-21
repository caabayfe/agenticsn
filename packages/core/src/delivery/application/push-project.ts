import { readUnits } from "../../authoring/application/read-units";
import type { InstanceCopy } from "../../authoring/domain/unit";
import { unitSpec } from "../../authoring/index";
import { GLOBAL } from "../domain/batch";
import { RecordChangedOnInstanceError } from "../domain/errors";
import type { PlannedUnit } from "../domain/unit-plan";
import { nextCount, stampedXml } from "../domain/unit-stamp";
import type { PushJournal, SwitchedPreference } from "../ports";
import { readRefusals } from "./load-refusals";
import { observePending, stagePending } from "./pending-journal";
import type { ProjectLoad } from "./plan-units";
import { publishLoaded } from "./publish-loaded";
import { outcomes } from "./push-outcomes";
import { settle, switchFor } from "./push-preferences";
import { readBack } from "./push-read-back";
import { openChild } from "./push-steps";
import type { ProjectPush, ProjectRun, PushedUnit } from "./push-types";

// One project's push (ADR-0031 item 4): its application made current, its update set opened,
// every planned unit checked against the version the plan saw, then one fluent/load of the
// stamped files, flows published, capture checked, and each unit read back.

// Units push sends to the instance: not those only recorded or forgotten in the ledger.
const loaded = (unit: PlannedUnit) => unit.operation !== "record" && unit.operation !== "forget";

// Refuses when any unit moved on the instance since the plan read it.
function ensureUnmoved(
  units: readonly PlannedUnit[],
  copies: ReadonlyMap<string, InstanceCopy | null>,
  journal: PushJournal,
): void {
  for (const unit of units.filter((unit) => unit.operation !== "forget")) {
    const now = copies.get(unit.updateName)?.version ?? null;
    if (now === unit.version) continue;
    const loaded = journal.steps.filter((step) => step.state === "written").length;
    throw new RecordChangedOnInstanceError(unit, journal.instance ?? "<instance>", loaded);
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
  await publishLoaded(run.installer, load.project.scope, files, run.session.signal);
}

// The platform sets some fields its own way when it inserts a record, such as a new table's
// label, and keeps the loaded value only on an update: created units that read back otherwise
// are loaded once more, then read back again.
async function loadedAgain(
  run: ProjectRun,
  load: ProjectLoad,
  updateSet: string,
  back: Awaited<ReturnType<typeof readBack>>,
) {
  const again = load.units.filter(
    (u) =>
      u.operation === "create" &&
      unitSpec(u.table).comparable &&
      !back.applied.get(u.updateName) &&
      back.copies.get(u.updateName),
  );
  if (again.length === 0) return back;
  await loadAndPublish(run, load, updateSet, filesFor(load, again, back.copies, run.now()));
  return readBack(run.session, load, load.units);
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
    ensureUnmoved(units, before, journal.current);
    await prefer("apps.current_app", project.scopeId);
    const set = await openSet(run, load);
    // A scoped write makes the platform switch the user's global current update set too, so
    // push takes that preference as well, to put it back afterwards.
    await prefer("sys_update_set", project.scopeId === GLOBAL ? set.sysId : run.batch.sysId);
    if (project.scopeId !== GLOBAL) await prefer(`updateSetForScope${project.scopeId}`, set.sysId);
    const loadedAt = run.now();
    await stagePending(run, load, set.sysId);
    await loadAndPublish(run, load, set.sysId, filesFor(load, units, before, loadedAt));
    const back = await loadedAgain(run, load, set.sysId, await readBack(run.session, load, units));
    const arrived = await outcomes(run, load, set.sysId, back);
    const pushed = await withRefusals(run, units, arrived, loadedAt);
    await observePending(run, pushed, back.copies);
    await settle(session, journal, save);
    return { updateSet: set, units: pushed, ledger: back.ledger };
  } catch (error) {
    // The step that failed is what the user needs to see; a failed restore stays journaled.
    await settle(session, journal, save).catch(() => {});
    throw error;
  }
}
