import type { FingerprintChange } from "../domain/fingerprint";
import { aheadOfClock } from "../domain/pull-state";
import { FIRST_REDACTION_VERSION } from "../domain/redaction-upgrades";
import { FutureWatermarkError } from "../domain/shared-mirror-errors";
import type { SyncState } from "../ports";
import type { IncrementalDependencies } from "./incremental-dependencies";
import { SECRET_SCAN_VERSION } from "./secret-migration";

// The instance has answered by now: a watermark ahead of its clock would hide changes.
export function refuseFutureWatermark(
  deps: IncrementalDependencies,
  state: SyncState,
  instance: string,
): void {
  const clock = deps.instanceTime?.() ?? null;
  if (clock !== null && aheadOfClock(state.watermark, clock)) {
    throw new FutureWatermarkError(instance, state.watermark);
  }
}

// Nothing moved on the instance, and no policy asked to rewrite what the mirror holds. A version
// other than this binary's own, above it too, isn't one it applied (spec 014, SEC2-03).
export function isIdle(
  state: SyncState,
  policyVersion: number,
  run: { readonly verify: boolean; readonly moved: boolean },
): boolean {
  return (
    !run.verify &&
    !run.moved &&
    state.secretScanVersion === SECRET_SCAN_VERSION &&
    (state.redactionVersion ?? FIRST_REDACTION_VERSION) === policyVersion
  );
}

// Whether the pull may write what it reads from the instance: then its redaction needs a
// catalog this clone can rely on (spec 014, SEC2-03).
export function writesInstanceData(
  state: SyncState,
  policyVersion: number,
  run: {
    readonly verify: boolean;
    readonly changes: ReadonlyMap<string, FingerprintChange>;
    readonly stale: number;
  },
): boolean {
  return (
    run.verify ||
    run.stale > 0 ||
    [...run.changes.values()].some((change) => change !== "unchanged") ||
    (state.redactionVersion ?? FIRST_REDACTION_VERSION) !== policyVersion
  );
}
