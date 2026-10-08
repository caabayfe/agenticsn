import { checkDue, noticeText } from "../domain/notice";
import { compareVersions } from "../domain/version";
import type { ReleaseSource, UpdateCheckStore } from "../ports";

export interface UpdateNoticeDependencies {
  readonly releases: ReleaseSource;
  readonly store: UpdateCheckStore;
  readonly current: string;
  readonly now: () => Date;
  readonly signal: AbortSignal;
}

// The notice line when a newer release exists, asking GitHub at most once a day (ADR-0023).
// A failed check is silent and waits a day like any other.
export async function updateNotice(deps: UpdateNoticeDependencies): Promise<string | null> {
  const last = await deps.store.read();
  let latest = last?.latest ?? null;
  if (checkDue(last?.checkedAt ?? null, deps.now())) {
    try {
      latest = (await deps.releases.latest(deps.signal)).version;
    } catch {
      // Offline, rate limited or slow: say nothing, and try again tomorrow.
    }
    await deps.store.write({ checkedAt: deps.now().toISOString(), latest });
  }
  return latest !== null && compareVersions(latest, deps.current) > 0 ? noticeText(latest) : null;
}
