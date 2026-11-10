import { minutesSince, nextCommand, type SyncPhase, syncPhase } from "../domain/sync-phase";
import type { MirrorInspector, SyncStateStore } from "../ports";
import type { SharedMirrorStatus } from "./shared-mirror";

export interface StatusDependencies {
  readonly state: SyncStateStore;
  readonly inspector: MirrorInspector;
  readonly now: () => Date;
  // The team's shared mirror, as git last fetched it (ADR-0052 item 6).
  readonly shared?: SharedMirrorStatus;
}

function sharedFacts(shared: SharedMirrorStatus | undefined, localMinutes: number | null) {
  if (shared === undefined) return undefined;
  const ages = [localMinutes, shared.ageMinutes].filter((age): age is number => age !== null);
  return {
    ahead: shared.ahead,
    newestMinutes: ages.length === 0 ? null : Math.min(...ages),
    maxAgeMinutes: shared.maxAgeMinutes,
  };
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
  readonly sharedMirror: SharedMirrorStatus | null;
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
  const minutesSinceLastPull = state === null ? null : minutesSince(state.watermark, deps.now());
  return {
    instance,
    phase,
    lastPull: state?.watermark ?? null,
    lastFullPull: state?.lastFullPull ?? null,
    minutesSinceLastPull,
    interrupted:
      checkpoint === null
        ? null
        : { startedAt: checkpoint.startedAt, completedClasses: checkpoint.completedClasses.length },
    remoteCommit: view.remoteCommit,
    unintegratedPulls: view.unintegratedPulls,
    localChanges: view.localChanges,
    sharedMirror: deps.shared ?? null,
    next: nextCommand(phase, instance, sharedFacts(deps.shared, minutesSinceLastPull)),
  };
}
