// A local environment check reported by `snagentic doctor`.

export const CHECK_STATUSES = ["ok", "fail", "unavailable"] as const;

export type CheckStatus = (typeof CHECK_STATUSES)[number];

export interface Check {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
  // The next action when the check is not ok; null when there is nothing to do.
  readonly hint: string | null;
}

export interface DoctorReport {
  readonly ok: boolean;
  readonly checks: readonly Check[];
}

// "unavailable" means the capability does not exist on this platform (for example no
// keychain on a headless Linux server). It is reported, but it does not make doctor fail.
export function summarizeChecks(checks: readonly Check[]): DoctorReport {
  return { ok: checks.every((check) => check.status !== "fail"), checks };
}
