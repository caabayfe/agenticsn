import type { PullOutput } from "./pull-output";
import { renderCurrent, sharedLines } from "./pull-shared-output";

// The text a person reads after a pull.
function secretLines(redactions: PullOutput["secretRedactions"]): string[] {
  if (redactions.length === 0) return [];
  return [
    `  warning: ${redactions.length} instance-derived file(s) contained a high-confidence secret and were redacted before writing`,
    ...redactions.map((redaction) => `    ${redaction.path}: ${redaction.patterns.join(", ")}`),
    "  remove the secret from the instance and rotate the credential; earlier git history may still contain it",
  ];
}

const seconds = (milliseconds: number) => `${Math.round(milliseconds / 100) / 10} s`;

function serverLine(output: PullOutput): string[] {
  const cost = output.serverCost;
  if (!output.serverCostRequested) {
    return [];
  }
  if (cost === null) {
    return ["  server cost: unavailable (this user cannot read the transaction log)"];
  }
  return [
    `  server cost: ${seconds(cost.responseMs)} in ${cost.transactions} logged transactions (slowest ${seconds(cost.maxResponseMs)}); SQL ${seconds(cost.sqlMs)} in ${cost.sqlQueries} queries; CPU ${seconds(cost.cpuMs)}; ACLs ${seconds(cost.aclMs)}; business rules ${seconds(cost.businessRuleMs)}`,
  ];
}

function load(output: PullOutput): string {
  return [
    `  instance load: ${output.requests} requests, ${output.retries} retries, semaphore wait ${output.semaphoreWaitMs} ms, peak concurrency ${output.peakConcurrency}${output.timeouts > 0 ? `, ${output.timeouts} timed out` : ""}`,
    ...serverLine(output),
  ].join("\n");
}

function renderFull(output: PullOutput, full: NonNullable<PullOutput["full"]>): string[] {
  const phases = full.phaseSeconds;
  return [
    `pulled ${output.instance}${output.resumed ? " (resumed)" : ""} in ${output.seconds} s -> ${output.commit.slice(0, 10)} on servicenow-remote/${output.instance}`,
    `  ${output.records} records in ${full.classes} classes, ${full.childRows} child rows, ${full.operationalRows} inventory rows, ${full.skippedRows} skipped`,
    ...malformedLine(full.malformedValues),
    ...secretLines(output.secretRedactions),
    load(output),
    `  time: catalog ${phases.catalog} s, records ${phases.records} s, child rows ${phases.children} s, inventory ${phases.operational} s, commit ${phases.commit} s; ${output.requestSeconds} s in requests; peak memory ${output.peakMemoryMb} MB`,
  ];
}

// Property values kept only when shaped like their type (ADR-0034): say how many were not.
function malformedLine(count: number): string[] {
  return count === 0
    ? []
    : [`  ${count} property values redacted: not shaped like their property's type`];
}

// Records deleted on the instance without a deletion record stay in the mirror; say so
// rather than report the mirror as current.
function lostWarning(output: PullOutput, lost: number): string[] {
  return lost === 0
    ? []
    : [
        `  warning: ${lost} records left the instance without a deletion record and are still in the mirror`,
        `  to remove them: snagentic pull ${output.instance} --full`,
      ];
}

function verificationLines(changes: NonNullable<PullOutput["incremental"]>): string[] {
  const v = changes.verification;
  if (v === null) {
    return [];
  }
  return [
    `  verified: ${v.scopes} scopes by count, ${v.scopesDiffering} differing; ${v.countRequests} count requests, ${v.listedRows} ids listed`,
    `  repaired: ${v.recovered} records recovered, ${v.removed} removed${v.hiddenRows > 0 ? `; ${v.hiddenRows} records counted but hidden from this user` : ""}${v.unmirrorable > 0 ? `; ${v.unmirrorable} records cannot be mirrored (unreadable class or invalid sys_id)` : ""}${v.unverifiable > 0 ? `; ${v.unverifiable} legacy ids could not be checked` : ""}`,
    ...v.unlisted.map(
      (part) =>
        `  warning: the instance fails to list ${part.scope} ids starting ${part.prefix} (server error, typically a record whose read ACL throws); its ${part.records} records were not verified`,
    ),
  ];
}

function renderIncremental(
  output: PullOutput,
  changes: NonNullable<PullOutput["incremental"]>,
): string[] {
  const warning = [
    ...verificationLines(changes),
    ...(changes.verification === null ? lostWarning(output, changes.lostRecords) : []),
  ];
  if (!output.changed) {
    const status = warning.length === 0 ? "is up to date" : "has no new changes to mirror";
    return [`${output.instance} ${status} (${output.seconds} s)`, ...warning, load(output)];
  }
  return [
    `pulled ${output.instance} changes in ${output.seconds} s -> ${output.commit.slice(0, 10)} on servicenow-remote/${output.instance}`,
    `  records: ${output.records} written, ${changes.renamed} renamed, ${changes.deleted} deleted, ${changes.skippedRows} skipped${changes.catalogRefreshed ? "; catalog read again" : ""}`,
    `  child rows: ${changes.childFiles} files refreshed, ${changes.removedChildFiles} removed`,
    ...(changes.rereadForRedaction.length > 0
      ? [`  read again for the new redaction rules: ${changes.rereadForRedaction.join(", ")}`]
      : []),
    ...malformedLine(changes.malformedValues),
    ...secretLines(output.secretRedactions),
    ...(changes.inventoryRefreshed.length > 0
      ? [`  inventory listed again: ${changes.inventoryRefreshed.join(", ")}`]
      : []),
    `  changed on the instance: ${changes.changedSources.join(", ") || "nothing"}`,
    ...warning,
    load(output),
  ];
}

export function renderPull(output: PullOutput): string {
  if (output.mode === "current") return renderCurrent(output.instance, output.shared);
  const lines = output.incremental
    ? renderIncremental(output, output.incremental)
    : output.full
      ? renderFull(output, output.full)
      : [];
  const unreadable = output.unreadable.length === 0 ? "none" : output.unreadable.join(", ");
  return [
    ...lines,
    `  not readable by this user: ${unreadable}`,
    ...sharedLines(output.shared),
    ...(output.changed ? [`next: snagentic integrate ${output.instance}`] : []),
  ].join("\n");
}
