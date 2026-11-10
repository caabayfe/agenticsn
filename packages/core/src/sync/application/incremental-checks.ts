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

// Nothing moved on the instance, and no policy asked to rewrite what the mirror holds.
export function isIdle(
  state: SyncState,
  policyVersion: number,
  run: { readonly verify: boolean; readonly moved: boolean },
): boolean {
  return (
    !run.verify &&
    !run.moved &&
    (state.secretScanVersion ?? 0) >= SECRET_SCAN_VERSION &&
    (state.redactionVersion ?? FIRST_REDACTION_VERSION) === policyVersion
  );
}
