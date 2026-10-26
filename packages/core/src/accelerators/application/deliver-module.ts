import { deliveredDetail } from "../domain/earlier-sets";
import type { EnsureFact } from "../domain/ensure";
import type { Adoption } from "../domain/materialize";
import type { FormDelivery } from "./ensure-forms";
import { ensureLayouts } from "./ensure-layouts";
import type { InstallRunDependencies } from "./install-step";

// A module's out-of-box records become this branch's only where the client never changed them:
// otherwise the module stops for the admin's review, before anything of it is pushed.
async function takeOver(
  deps: InstallRunDependencies,
  adoptions: readonly Adoption[],
  signal: AbortSignal,
) {
  if (adoptions.length === 0) return;
  const result = await deps.steps.takeOver(adoptions, signal);
  // A record the module may create is pushed from its source where the instance lacks it.
  const created = new Set(
    adoptions.filter((a) => a.whenAbsent === "create").map((a) => `${a.table} ${a.sysId}`),
  );
  const refused = [
    ...result.customized.map((r) => `customized on the instance: ${r}`),
    ...result.absent.filter((r) => !created.has(r)).map((r) => `not on the instance: ${r}`),
  ];
  if (refused.length > 0) {
    throw new Error(`${refused.join("; ")} (review it, then resume or drop it from the module)`);
  }
}

// Why a module's push did not arrive whole: the platform's reasons first, with their actions,
// then what is left unexplained.
function undelivered(pushed: Awaited<ReturnType<InstallRunDependencies["steps"]["push"]>>) {
  const refused = pushed.refused.map(
    (g) =>
      `the instance refused ${g.records.length} ${g.table} record(s) (${g.reason}): ${g.action}`,
  );
  const explained = pushed.refused.reduce((n, g) => n + g.records.length, 0);
  const captured = pushed.notCaptured - explained;
  const applied = pushed.notApplied - explained;
  const rest =
    captured + applied > 0
      ? [`${captured} not captured, ${applied} not applied as built`, ...pushed.mismatched]
      : [];
  return [...refused, ...rest].join("; ");
}

// Delivers modules already added (`ids`, cumulative) into the update sets named by `label`.
export async function deliverAs(
  deps: InstallRunDependencies,
  ids: readonly string[],
  changes: {
    readonly pack: string;
    readonly adoptions: readonly Adoption[];
    readonly ensures: readonly EnsureFact[];
    readonly forms: FormDelivery;
  },
  labels: { readonly label: string; readonly own: readonly string[] },
  signal: AbortSignal,
): Promise<{ outcome: "done" | "skipped"; detail: string }> {
  const { label, own } = labels;
  const added = await deps.steps.add(ids, signal);
  if (added.conflicts.length > 0) throw new Error(`merge conflicts: ${added.conflicts.join(", ")}`);
  // The generated layout files first, so their records get keys with the module's (SN-MNT-010).
  const layouts = await ensureLayouts(deps, changes.pack, changes.ensures, changes.forms, signal);
  await deps.steps.keys([...added.copied, ...layouts.written], signal);
  await takeOver(deps, [...changes.adoptions, ...layouts.adoptions], signal);
  const planned = await deps.steps.planPush(label, signal, own);
  if (planned.units === 0 && planned.problems.length === 0) {
    return { outcome: "skipped", detail: "the instance already holds it as built" };
  }
  if (!planned.ready) throw new Error(`plan not ready: ${planned.problems.join("; ")}`);
  const pushed = await deps.steps.push(planned.planId, label, signal);
  if (pushed.notApplied + pushed.notCaptured > 0) throw new Error(undelivered(pushed));
  return { outcome: "done", detail: deliveredDetail(pushed.units, pushed.updateSets) };
}
