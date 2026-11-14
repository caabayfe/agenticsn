import type { InstanceCopy } from "../../authoring/domain/unit";
import { PendingDeliveryTargetError } from "../domain/errors";
import type { PendingDelivery, PushJournal, PushJournalStore } from "../ports";
import type { ProjectLoad } from "./plan-units";
import type { PushedUnit } from "./push-types";

interface JournalRun {
  readonly journal: { current: PushJournal };
  readonly store: PushJournalStore;
}

export async function startJournal(
  store: PushJournalStore,
  target: {
    readonly instance: string;
    readonly url: string;
    readonly label: string;
    readonly planId: string;
    readonly startedAt: string;
  },
): Promise<{ current: PushJournal }> {
  const unfinished = await store.read();
  const journal = {
    current: {
      ...target,
      mirrorCommit: "",
      pending: unfinished?.pending ?? [],
      preferences: [],
      steps: [],
    },
  };
  await store.write(journal.current);
  return journal;
}

// Persist intent before sending any metadata. A write whose outcome is unknown remains
// pending, including when load/publish throws or a later project's delivery fails.
export async function stagePending(run: JournalRun, load: ProjectLoad, updateSet: string) {
  const pending: PendingDelivery[] = [...(run.journal.current.pending ?? [])];
  for (const unit of load.units) {
    const old = pending.find(
      (p) =>
        p.project === unit.project &&
        (p.updateName === unit.updateName ||
          (p.operation === "delete" && p.digest === unit.digest)),
    );
    if (old !== undefined && old.updateSet !== updateSet)
      throw new PendingDeliveryTargetError(unit.updateName);
    if (unit.operation === "record" && old !== undefined && old.updateName !== unit.updateName) {
      pending.splice(pending.indexOf(old), 1, {
        ...old,
        updateName: unit.updateName,
        captureName: old.captureName ?? old.updateName,
      });
    }
    if (unit.operation === "forget" || unit.operation === "record") continue;
    if (old !== undefined) pending.splice(pending.indexOf(old), 1);
    pending.push({
      project: unit.project,
      updateName: unit.updateName,
      digest: unit.digest,
      updateSet,
      before: unit.version,
      operation: unit.operation,
      removes: unit.removes,
    });
  }
  run.journal.current = { ...run.journal.current, pending };
  await run.store.write(run.journal.current);
}

// Evidence survives until git has committed the ledgers, not just until fluent/load returns.
export async function observePending(
  run: JournalRun,
  units: readonly PushedUnit[],
  copies: ReadonlyMap<string, InstanceCopy | null>,
) {
  const pending = (run.journal.current.pending ?? []).map((entry) => {
    const unit = units.find(
      (u) => u.project === entry.project && u.updateName === entry.updateName,
    );
    return unit === undefined
      ? entry
      : {
          ...entry,
          observed: copies.get(entry.updateName)?.version ?? null,
          verified: unit.applied && unit.captured,
        };
  });
  run.journal.current = { ...run.journal.current, pending };
  await run.store.write(run.journal.current);
}

export async function finishPending(run: JournalRun, units: readonly PushedUnit[]) {
  const pending = (run.journal.current.pending ?? []).filter(
    (entry) =>
      !units.some(
        (u) =>
          u.project === entry.project &&
          u.updateName === entry.updateName &&
          u.applied &&
          u.captured,
      ),
  );
  run.journal.current = { ...run.journal.current, pending };
  if (pending.length === 0 && run.journal.current.preferences.length === 0) await run.store.clear();
  else await run.store.write(run.journal.current);
}
