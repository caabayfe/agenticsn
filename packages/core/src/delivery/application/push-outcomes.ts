import { type BuiltUnit, isDeletion } from "../../authoring/domain/unit";
import { unitSpec } from "../../authoring/domain/unit-specs";
import { compiledCopyAgrees } from "../domain/capture-content";
import { carrierOf } from "../domain/carried";
import type { PlannedUnit } from "../domain/unit-plan";
import type { CaptureContent } from "../ports";
import { captureEvidence } from "./capture-evidence";
import type { ProjectLoad } from "./plan-units";
import type { readBack } from "./push-read-back";
import type { ProjectRun, PushedUnit } from "./push-types";

type ReadBack = Awaited<ReturnType<typeof readBack>>;
const CAPTURE_MISMATCH =
  "captured definition does not match the reviewed build, or lacks its published snapshot";

function compiledAgrees(unit: BuiltUnit, captured: CaptureContent | null, back: ReadBack): boolean {
  return (
    captured !== null &&
    compiledCopyAgrees(
      unit,
      captured.unit,
      captured.live ?? back.copies.get(unit.updateName) ?? null,
    )
  );
}

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
  const captured = !needsCapture || evidence !== null;
  const compiled = built !== undefined && !isDeletion(built) && !unitSpec(table).comparable;
  const applied = compiled
    ? compiledAgrees(built, evidence, back)
    : (back.applied.get(updateName) ?? true);
  const mismatches =
    compiled && !applied ? [CAPTURE_MISMATCH] : (back.mismatches.get(updateName) ?? []);
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
