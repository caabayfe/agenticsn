import { readUnits } from "../../authoring/application/read-units";
import { compareUnit } from "../../authoring/domain/compare";
import type { LedgerEntry } from "../../authoring/domain/ledger";
import type { BuiltUnit, InstanceCopy } from "../../authoring/domain/unit";
import { unitSpec } from "../../authoring/domain/unit-specs";
import type { PlannedUnit } from "../domain/unit-plan";
import type { ProjectLoad } from "./plan-units";
import type { InstanceSession } from "./push-steps";

// What the instance holds after the load, unit by unit, and the ledger it makes.
export async function readBack(
  session: InstanceSession,
  load: ProjectLoad,
  units: readonly PlannedUnit[],
) {
  const built = units.flatMap((u) => load.built.get(u.updateName)?.unit ?? []);
  const copies = await readUnits(session.reader, built, session.signal);
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
    const entry = loadedEntry(unit, copy, same);
    if (entry !== null) ledger.set(unit.updateName, entry);
  }
  return { ledger, applied, copies };
}

// A loaded unit's new ledger entry, or null to keep the one it has.
function loadedEntry(
  unit: PlannedUnit,
  copy: InstanceCopy | null,
  same: boolean,
): LedgerEntry | null {
  if (copy === null) return null;
  if (same) return { build: unit.digest, instance: copy.version, losses: unit.losses };
  return unit.operation === "create"
    ? { build: NOT_BUILT, instance: copy.version, losses: [] }
    : null;
}

// The build of a record this push created but that reads back otherwise (the platform sets a
// new table's label its own way): no build matches it, so the next plan loads it again rather
// than asking to adopt a record the push itself made.
const NOT_BUILT = "0".repeat(32);

const agrees = (unit: BuiltUnit, copy: InstanceCopy) =>
  !unitSpec(unit.head.table).comparable || compareUnit(unit, copy).length === 0;
