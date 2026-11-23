import {
  type BuiltUnit,
  compiledCopyDifferences,
  isDeletion,
  unitSpec,
} from "../../authoring/index";
import { carrierOf } from "../domain/carried";
import type { PlannedUnit } from "../domain/unit-plan";
import { type CaptureEvidence, captureEvidence } from "./capture-evidence";
import type { ProjectLoad } from "./plan-units";
import type { readBack } from "./push-read-back";
import type { ProjectRun, PushedUnit } from "./push-types";

type ReadBack = Awaited<ReturnType<typeof readBack>>;
const SHOWN = 5;

const listed = (places: readonly string[]): string =>
  places.length > SHOWN
    ? `${places.slice(0, SHOWN).join(", ")} and ${places.length - SHOWN} more`
    : places.join(", ");

const GAPS = {
  absent: "no capture of this definition was found in the update set",
  unreadable: "the capture of this definition in the update set could not be read",
  unpublished:
    "the capture in the update set is not a published definition: it lacks its published snapshot",
} as const;

// Why a flow or action is not delivered as reviewed: which check failed, and where the
// definitions differ (names only). Empty when its capture and live copy both agree.
function compiledMismatches(
  unit: BuiltUnit,
  evidence: CaptureEvidence | null,
  back: ReadBack,
): string[] {
  if (evidence === null) return ["no capture was read for this definition"];
  if (evidence.content === null) {
    const { gap } = evidence;
    return gap.kind === "content"
      ? [`the captured definition does not match the reviewed build: ${listed(gap.differences)}`]
      : [GAPS[gap.kind]];
  }
  const { content } = evidence;
  const live = content.live ?? back.copies.get(unit.updateName) ?? null;
  const differences = compiledCopyDifferences(unit, content.unit, live);
  return differences.length === 0
    ? []
    : [`the definition on the instance does not match the reviewed build: ${listed(differences)}`];
}

const comparedMismatches = (updateName: string, back: ReadBack): readonly string[] =>
  (back.applied.get(updateName) ?? true) ? [] : (back.mismatches.get(updateName) ?? []);

async function outcome(
  run: ProjectRun,
  load: ProjectLoad,
  unit: PlannedUnit,
  updateSet: string,
  back: ReadBack,
): Promise<PushedUnit> {
  const { project, updateName, table, name, operation } = unit;
  const built = load.built.get(updateName)?.unit;
  const pending = run.journal.current.pending?.find(
    (entry) => entry.project === project && entry.updateName === updateName,
  );
  const needsCapture = operation !== "forget" && (operation !== "record" || pending !== undefined);
  const evidence =
    needsCapture && built !== undefined
      ? await captureEvidence(
          run.session,
          built,
          {
            updateSet,
            username: run.username,
            scopeId: load.project.scopeId,
            captureName: pending?.captureName ?? updateName,
          },
          run.decodeCapture,
          back.copies.get(updateName) ?? null,
        )
      : null;
  const captured = !needsCapture || (evidence !== null && evidence.content !== null);
  const compiled = built !== undefined && !isDeletion(built) && !unitSpec(table).comparable;
  const mismatches = compiled
    ? compiledMismatches(built, evidence, back)
    : comparedMismatches(updateName, back);
  const applied = mismatches.length === 0 && (compiled || (back.applied.get(updateName) ?? true));
  return {
    project,
    updateName,
    table,
    name,
    operation,
    captured,
    applied,
    refused: null,
    mismatches,
  };
}

// Labels travel in a dictionary's update, provided that dictionary is itself verified.
function withCarried(
  load: ProjectLoad,
  pushed: readonly PushedUnit[],
  pending: ReadonlySet<string>,
): PushedUnit[] {
  const loaded = new Map(
    pushed
      .filter((u) => u.operation !== "record" || pending.has(u.updateName))
      .map((u) => [u.updateName, u]),
  );
  return pushed.map((unit) => {
    if (unit.captured || !unit.applied || unit.operation === "delete") return unit;
    const built = load.built.get(unit.updateName)?.unit;
    const carrier = built === undefined ? null : carrierOf(built);
    const verified = loaded.get(carrier ?? "");
    return verified?.captured === true && verified.applied ? { ...unit, captured: true } : unit;
  });
}

export async function outcomes(
  run: ProjectRun,
  load: ProjectLoad,
  updateSet: string,
  back: ReadBack,
): Promise<PushedUnit[]> {
  const pushed: PushedUnit[] = [];
  for (const unit of load.units) pushed.push(await outcome(run, load, unit, updateSet, back));
  const pending = new Set(
    run.journal.current.pending
      ?.filter((entry) => entry.project === load.project.path)
      .map((entry) => entry.updateName),
  );
  const carried = withCarried(load, pushed, pending);
  for (const unit of carried.filter((unit) => unit.applied && unit.captured))
    recordDelivered(load, unit, back);
  for (const unit of carried.filter((u) => !u.applied || !u.captured)) {
    back.ledger.delete(unit.updateName);
    const removes = load.units.find((u) => u.updateName === unit.updateName)?.removes;
    if (removes != null) back.ledger.delete(removes);
  }
  return carried;
}

function recordDelivered(load: ProjectLoad, pushed: PushedUnit, back: ReadBack) {
  const unit = load.units.find((unit) => unit.updateName === pushed.updateName);
  const built = load.built.get(pushed.updateName)?.unit;
  const copy = back.copies.get(pushed.updateName);
  if (
    unit === undefined ||
    built === undefined ||
    isDeletion(built) ||
    copy == null ||
    pushed.operation === "forget"
  )
    return;
  back.ledger.set(unit.updateName, {
    build: unit.digest,
    instance: copy.version,
    losses: unit.losses,
  });
}
