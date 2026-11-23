// The advisory gate's decision (SEC3-07): an audit that produced no valid report did not run,
// which is a failure of its own and never "no advisories".
import {
  type AdvisoryComparison,
  compareAdvisories,
  findingsOf,
  parseAudit,
  type RegisterEntry,
} from "./advisories";
import type { Lockfile } from "./lockfile";

export interface AuditRun {
  // null when a signal stopped the process.
  readonly exitCode: number | null;
  readonly stdout: string;
}

export type GateOutcome =
  | { readonly kind: "not-run"; readonly reason: string }
  | { readonly kind: "checked"; readonly failed: boolean; readonly comparison: AdvisoryComparison };

const notRun = (reason: string): GateOutcome => ({ kind: "not-run", reason });

// `bun audit --json` maps each package to the list of its advisories, and prints {} for none.
function isReport(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((items) => Array.isArray(items))
  );
}

function ended(exitCode: number | null): string {
  return exitCode === null ? "was stopped by a signal" : `exited with ${exitCode}`;
}

export function advisoryGate(
  run: AuditRun,
  lock: Lockfile,
  register: readonly RegisterEntry[],
  today: string,
): GateOutcome {
  const output = run.stdout.trim();
  if (output === "") return notRun(`bun audit ${ended(run.exitCode)} and printed no report`);
  let report: unknown;
  try {
    report = JSON.parse(output);
  } catch {
    return notRun("bun audit's output is not JSON");
  }
  if (!isReport(report)) {
    return notRun("bun audit's output is not a report (packages mapped to their advisories)");
  }
  const advisories = parseAudit(output);
  // It exits non-zero when it reports an advisory; non-zero with none reported is a failed run.
  if (run.exitCode !== 0 && advisories.length === 0) {
    return notRun(`bun audit ${ended(run.exitCode)} and reported no advisory`);
  }
  const comparison = compareAdvisories(findingsOf(advisories, lock), register, today);
  const failed =
    comparison.unrecorded.length + comparison.changed.length + comparison.expired.length > 0;
  return { kind: "checked", failed, comparison };
}
