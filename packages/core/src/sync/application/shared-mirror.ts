import { isCurrent, isLater } from "../domain/pull-state";
import { PublishRefusedError } from "../domain/shared-mirror-errors";
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

async function takesShared(
  deps: SharedPullDependencies,
  root: string,
  tip: string | null,
  shared: SharedTip | null,
  local: SyncState | null,
  publishing: boolean,
): Promise<boolean> {
  if (shared === null || shared.state === null) return false;
  if (tip === shared.commit) return false;
  if (local === null || tip === null) return true;
  if (isLater(shared.state.watermark, local.watermark)) return true;
  // A publisher pushes fast-forward only: it continues from the shared tip unless its own
  // branch already builds on it.
  return publishing && !(await deps.shared.contains(root, tip, shared.commit));
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
  const shared = await deps.shared.fetch(root, instance, setting.remote);
  const local = await deps.state.readState();
  const tip = await deps.shared.localTip(root, instance);
  const moved = await takesShared(deps, root, tip, shared, local, publishing);
  if (moved && shared !== null) {
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
    current: start !== null && isCurrent(start.watermark, deps.now(), setting.maxAgeMinutes),
  };
}

// ADR-0052 item 5: only the user the shared state names publishes; a new branch names no one.
export function checkPublisher(start: SharedStart, instance: string, user: string): void {
  const owner = start.shared?.state?.pulledBy;
  if (owner !== undefined && owner !== user) {
    throw new PublishRefusedError(instance, user, owner);
  }
}
