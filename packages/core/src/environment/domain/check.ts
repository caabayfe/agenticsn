// A local environment check reported by `snagentic doctor`.

export const CHECK_STATUSES = ["ok", "warn", "fail", "unavailable"] as const;

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

// "warn" and "unavailable" are reported with their hint but do not make doctor fail.
// "unavailable" means the capability does not exist here (no keychain on a headless
// Linux server) or could not be checked because an earlier check failed.
export function summarizeChecks(checks: readonly Check[]): DoctorReport {
  return { ok: checks.every((check) => check.status !== "fail"), checks };
}
