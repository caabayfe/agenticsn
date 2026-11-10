import { isCurrent, isLater } from "../domain/pull-state";
import {
  PublishRefusedError,
  SharedMirrorDivergedError,
  SharedMirrorUnreachableError,
} from "../domain/shared-mirror-errors";
import { minutesSince } from "../domain/sync-phase";
import type { SharedMirror, SharedTip, SyncState, SyncStateStore } from "../ports";

// The instance profile's shared mirror setting.
export interface SharedPullSetting {
  readonly remote: string;
  readonly maxAgeMinutes: number;
}

export interface SharedPullDependencies {
  readonly shared: SharedMirror;
  readonly state: SyncStateStore;
  readonly now: () => Date;
}

export interface SharedStart {
  readonly remote: string;
  // The shared tip, as fetched; null when the remote has no mirror of this instance yet.
  readonly shared: SharedTip | null;
  // Where the pull continues from: this clone's branch, or the shared one it moved to.
  readonly from: "local" | "shared";
  // The watermark the pull continues from; null when there is nothing to continue.
  readonly watermark: string | null;
  // Younger than the profile's maxAge: a pull sends the instance nothing.
  readonly current: boolean;
}

interface Mirrors {
  // The local servicenow-remote/<name> tip and the state it carries.
  readonly tip: string | null;
  readonly local: SyncState | null;
  // The shared tip as fetched.
  readonly shared: SharedTip | null;
}

async function takesShared(
  deps: SharedPullDependencies,
  root: string,
  mirrors: Mirrors,
  publishing: boolean,
): Promise<boolean> {
  const { tip, local, shared } = mirrors;
  if (shared === null || shared.state === null) return false;
  if (tip === shared.commit) return false;
  if (local === null || tip === null) return true;
  if (isLater(shared.state.watermark, local.watermark)) return true;
  // A publisher pushes fast-forward only: it continues from the shared tip unless its own
  // branch already builds on it.
  return publishing && !(await deps.shared.contains(root, tip, shared.commit));
}

// One rule for "the mirror is current", for pull and status alike (ADR-0052 item 3): the
// watermark the next pull would continue from is younger than maxAge, and not ahead of the clock.
function currentAt(start: SyncState | null, now: Date, setting: SharedPullSetting): boolean {
  return start !== null && isCurrent(start.watermark, now, setting.maxAgeMinutes);
}

// Moving the local branch drops the commits it holds that the shared tip lacks. The fetch
// refuses a shared tip that does not contain what this clone fetched before (SEC2-06), so once
// the clone has fetched, those commits are its own unpublished pulls (ADR-0052 item 2); before
// that, nothing shows it, and only a fast-forward is taken.
async function checkMove(
  deps: SharedPullDependencies,
  root: string,
  instance: string,
  move: { readonly tip: string | null; readonly shared: string; readonly known: string | null },
): Promise<void> {
  if (move.tip === null || move.known !== null) return;
  if (!(await deps.shared.contains(root, move.shared, move.tip))) {
    throw new SharedMirrorDivergedError(instance, move.tip, move.shared);
  }
}

// ADR-0052 item 2: fetches the shared mirror and continues from whichever of it and this clone's
// branch has the later watermark, moving the local branch when that is the shared one. Local
// mirror commits are never published: the shared commit holds what they held.
export async function continueFromNewest(
  deps: SharedPullDependencies,
  root: string,
  instance: string,
  setting: SharedPullSetting,
  publishing = false,
): Promise<SharedStart> {
  const known = await deps.shared.lastFetched(root, instance, setting.remote);
  const shared = await deps.shared.fetch(root, instance, setting.remote);
  const local = await deps.state.readState();
  const tip = await deps.shared.localTip(root, instance);
  const moved = await takesShared(deps, root, { tip, local, shared }, publishing);
  if (moved && shared !== null) {
    await checkMove(deps, root, instance, { tip, shared: shared.commit, known });
    // Only from the tip just compared: a pull that moved it since is not overwritten.
    await deps.shared.moveTo(root, instance, { commit: shared.commit, expected: tip });
    // An interrupted pull older than the shared mirror is not worth finishing.
    const checkpoint = await deps.state.readCheckpoint();
    const watermark = shared.state?.watermark ?? "";
    if (checkpoint !== null && !isLater(checkpoint.startedAt, watermark)) {
      await deps.state.clearCheckpoint();
    }
  }
  const start = moved ? (shared?.state ?? null) : local;
  return {
    remote: setting.remote,
    shared,
    from: moved ? "shared" : "local",
    watermark: start?.watermark ?? null,
    current: currentAt(start, deps.now(), setting),
  };
}

// ADR-0052 item 5: only the user the shared state names publishes; a new branch names no one.
export function checkPublisher(start: SharedStart, instance: string, user: string): void {
  const owner = start.shared?.state?.pulledBy;
  if (owner !== undefined && owner !== user) {
    throw new PublishRefusedError(instance, user, owner);
  }
}

export interface SharedMirrorStatus {
  readonly remote: string;
  // False when git could not reach the remote; the rest is then unknown.
  readonly reachable: boolean;
  readonly commit: string | null;
  // Minutes since the shared mirror's watermark.
  readonly ageMinutes: number | null;
  readonly maxAgeMinutes: number;
  // The shared mirror holds pulls the local branch lacks: integrate brings them in.
  readonly ahead: boolean;
  // A pull now would ask the instance nothing: the same rule pull applies (SharedStart.current).
  readonly current: boolean;
}

// ADR-0052 item 6: how the team's mirror relates to this clone, from git alone.
export async function sharedMirrorStatus(
  deps: SharedPullDependencies,
  root: string,
  instance: string,
  setting: SharedPullSetting,
): Promise<SharedMirrorStatus> {
  const unknown = { remote: setting.remote, maxAgeMinutes: setting.maxAgeMinutes };
  let shared: SharedTip | null;
  try {
    shared = await deps.shared.fetch(root, instance, setting.remote);
  } catch (error) {
    if (error instanceof SharedMirrorUnreachableError) {
      const local = await deps.state.readState();
      return {
        ...unknown,
        reachable: false,
        commit: null,
        ageMinutes: null,
        ahead: false,
        current: currentAt(local, deps.now(), setting),
      };
    }
    throw error;
  }
  const tip = await deps.shared.localTip(root, instance);
  const local = await deps.state.readState();
  const newer = await takesShared(deps, root, { tip, local, shared }, false);
  const ahead =
    newer &&
    shared !== null &&
    (tip === null || !(await deps.shared.contains(root, tip, shared.commit)));
  return {
    ...unknown,
    reachable: true,
    commit: shared?.commit ?? null,
    ageMinutes: shared?.state ? minutesSince(shared.state.watermark, deps.now()) : null,
    ahead,
    current: currentAt(newer ? (shared?.state ?? null) : local, deps.now(), setting),
  };
}
