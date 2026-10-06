import { minutesSince, nextCommand, type SyncPhase, syncPhase } from "../domain/sync-phase";
import type { MirrorInspector, SyncStateStore } from "../ports";

export interface StatusDependencies {
  readonly state: SyncStateStore;
  readonly inspector: MirrorInspector;
  readonly now: () => Date;
}

export interface InstanceStatus {
  readonly instance: string;
  readonly phase: SyncPhase;
  // Watermark of the last completed pull: changes before it are mirrored.
  readonly lastPull: string | null;
  readonly lastFullPull: string | null;
  readonly minutesSinceLastPull: number | null;
  readonly interrupted: { readonly startedAt: string; readonly completedClasses: number } | null;
  readonly remoteCommit: string | null;
  readonly unintegratedPulls: number;
  readonly localChanges: readonly string[];
  readonly next: string;
}

// How fresh an instance's mirror is and what is pending, from local state and git only:
// it never calls the instance.
export async function instanceStatus(
  root: string,
  instance: string,
  deps: StatusDependencies,
): Promise<InstanceStatus> {
  const state = await deps.state.readState();
  const checkpoint = await deps.state.readCheckpoint();
  const view = await deps.inspector.inspect(root, instance);
  const phase = syncPhase({
    pulled: state !== null,
    interrupted: checkpoint !== null,
    unintegratedPulls: view.unintegratedPulls,
  });
  return {
    instance,
    phase,
    lastPull: state?.watermark ?? null,
    lastFullPull: state?.lastFullPull ?? null,
    minutesSinceLastPull: state === null ? null : minutesSince(state.watermark, deps.now()),
    interrupted:
      checkpoint === null
        ? null
        : { startedAt: checkpoint.startedAt, completedClasses: checkpoint.completedClasses.length },
    remoteCommit: view.remoteCommit,
    unintegratedPulls: view.unintegratedPulls,
    localChanges: view.localChanges,
    next: nextCommand(phase, instance),
  };
}
