// What an abandoned delivery leaves on the instance (ADR-0050, amendment A1): read from the
// push journal alone. Abandoning rolls nothing back, so this is the record of what stays.

// verified: applied and captured, its ledger never committed. unverified: written, and read
// back otherwise than built or not captured. unknown: the write's outcome was never read.
export type AbandonedOutcome = "verified" | "unverified" | "unknown";

export interface AbandonedUnit {
  readonly project: string;
  readonly updateName: string;
  readonly operation: string;
  readonly outcome: AbandonedOutcome;
  // The update set's sys_id and link; empty for a legacy journal, which did not record it.
  readonly updateSet: string;
  readonly link: string;
}

// What it reads of a receipt (authoring's PendingDelivery, structurally).
interface Receipt {
  readonly project: string;
  readonly updateName: string;
  readonly operation: string;
  readonly updateSet: string;
  readonly verified?: boolean;
  readonly observed?: string | null;
}

interface AbandonedJournal {
  readonly pending?: readonly Receipt[];
  readonly steps: readonly {
    readonly operation: string;
    readonly table: string;
    readonly sysId: string;
    readonly state: "sending" | "written";
  }[];
}

const OUTCOMES: Readonly<Record<AbandonedOutcome, string>> = {
  verified: "applied and captured, not recorded in the ledger",
  unverified: "written, not verified as built and captured",
  unknown: "outcome unknown, it may have been written",
};

function outcomeOf(entry: Receipt): AbandonedOutcome {
  if (entry.verified === true) return "verified";
  return entry.observed === undefined ? "unknown" : "unverified";
}

// Receipts when the journal has them; a legacy journal's steps otherwise (ADR-0050 item 7).
export function abandonedOf(journal: AbandonedJournal, url: string): AbandonedUnit[] {
  if (journal.pending !== undefined)
    return journal.pending.map((entry) => ({
      project: entry.project,
      updateName: entry.updateName,
      operation: entry.operation,
      outcome: outcomeOf(entry),
      updateSet: entry.updateSet,
      link: `${url}/sys_update_set.do?sys_id=${entry.updateSet}`,
    }));
  return journal.steps.map((step) => ({
    project: "",
    updateName: `${step.table}:${step.sysId}`,
    operation: step.operation,
    outcome: step.state === "written" ? "unverified" : "unknown",
    updateSet: "",
    link: "",
  }));
}

export function abandonedLine(unit: AbandonedUnit): string {
  const where =
    unit.updateSet === "" ? "update set not recorded" : `update set ${unit.updateSet} ${unit.link}`;
  return `${unit.operation} ${unit.updateName}: ${OUTCOMES[unit.outcome]}; ${where}`;
}

export const abandonSubject = (planId: string, instance: string) =>
  `chore(snagentic): abandon pending delivery of push ${planId} to ${instance}`;

// The commit that records the decision: no file changes, the list is its message.
export function abandonMessage(
  planId: string,
  instance: string,
  units: readonly AbandonedUnit[],
): string {
  return [
    abandonSubject(planId, instance),
    "",
    "Nothing was rolled back. No ledger changed. What stays on the instance:",
    ...units.map((unit) => `- ${abandonedLine(unit)}`),
  ].join("\n");
}
