import type { ConnectionStats, IncrementalSummary, PullSummary } from "@snagentic/core";
import { z } from "zod";

export const PullOutput = z.object({
  instance: z.string(),
  mode: z.enum(["full", "incremental"]),
  resumed: z.boolean(),
  // The tip of servicenow-remote/<name>; unchanged when an incremental pull found nothing.
  commit: z.string(),
  changed: z.boolean(),
  records: z.number(),
  unreadable: z.array(z.string()),
  watermark: z.string(),
  requests: z.number(),
  retries: z.number(),
  semaphoreWaitMs: z.number(),
  peakConcurrency: z.number(),
  requestSeconds: z.number(),
  seconds: z.number(),
  peakMemoryMb: z.number(),
  full: z
    .object({
      classes: z.number(),
      childRows: z.number(),
      operationalRows: z.number(),
      skippedRows: z.number(),
      phaseSeconds: z.object({
        catalog: z.number(),
        records: z.number(),
        children: z.number(),
        operational: z.number(),
        commit: z.number(),
      }),
    })
    .optional(),
  incremental: z
    .object({
      changedSources: z.array(z.string()),
      catalogRefreshed: z.boolean(),
      renamed: z.number(),
      deleted: z.number(),
      skippedRows: z.number(),
      childFiles: z.number(),
      removedChildFiles: z.number(),
      lostRecords: z.number(),
      verification: z
        .object({
          scopes: z.number(),
          scopesDiffering: z.number(),
          countRequests: z.number(),
          listedRows: z.number(),
          hiddenRows: z.number(),
          unverifiable: z.number(),
          unmirrorable: z.number(),
          recovered: z.number(),
          removed: z.number(),
        })
        .nullable(),
    })
    .optional(),
});
export type PullOutput = z.output<typeof PullOutput>;

const tenths = (milliseconds: number) => Math.round(milliseconds / 100) / 10;

export interface RunFacts {
  readonly instance: string;
  readonly resumed: boolean;
  readonly commit: string;
  readonly changed: boolean;
  readonly stats: ConnectionStats;
  readonly started: number;
  readonly committing: number;
  readonly peakMemoryMb: number;
}

function common(facts: RunFacts, summary: { unreadable: readonly string[]; watermark: string }) {
  return {
    instance: facts.instance,
    resumed: facts.resumed,
    commit: facts.commit,
    changed: facts.changed,
    unreadable: [...summary.unreadable],
    watermark: summary.watermark,
    requests: facts.stats.requests,
    retries: facts.stats.retries,
    semaphoreWaitMs: facts.stats.semaphoreWaitMs,
    peakConcurrency: facts.stats.peakConcurrency,
    requestSeconds: tenths(facts.stats.requestMs),
    seconds: tenths(performance.now() - facts.started),
    peakMemoryMb: facts.peakMemoryMb,
  };
}

export function fullOutput(facts: RunFacts, summary: PullSummary): PullOutput {
  return {
    ...common(facts, summary),
    mode: "full",
    records: summary.records,
    full: {
      classes: summary.classes,
      childRows: summary.childRows,
      operationalRows: summary.operationalRows,
      skippedRows: summary.skippedRows,
      phaseSeconds: {
        ...summary.phaseSeconds,
        commit: tenths(performance.now() - facts.committing),
      },
    },
  };
}

export function incrementalOutput(facts: RunFacts, summary: IncrementalSummary): PullOutput {
  return {
    ...common(facts, summary),
    mode: "incremental",
    records: summary.records,
    incremental: {
      changedSources: [...summary.changedSources],
      catalogRefreshed: summary.catalogRefreshed,
      renamed: summary.renamed,
      deleted: summary.deleted,
      skippedRows: summary.skippedRows,
      childFiles: summary.childFiles,
      removedChildFiles: summary.removedChildFiles,
      lostRecords: summary.lostRecords,
      verification: summary.verification,
    },
  };
}

function load(output: PullOutput): string {
  return `  instance load: ${output.requests} requests, ${output.retries} retries, semaphore wait ${output.semaphoreWaitMs} ms, peak concurrency ${output.peakConcurrency}`;
}

function renderFull(output: PullOutput, full: NonNullable<PullOutput["full"]>): string[] {
  const phases = full.phaseSeconds;
  return [
    `pulled ${output.instance}${output.resumed ? " (resumed)" : ""} in ${output.seconds} s -> ${output.commit.slice(0, 10)} on servicenow-remote/${output.instance}`,
    `  ${output.records} records in ${full.classes} classes, ${full.childRows} child rows, ${full.operationalRows} inventory rows, ${full.skippedRows} skipped`,
    load(output),
    `  time: catalog ${phases.catalog} s, records ${phases.records} s, child rows ${phases.children} s, inventory ${phases.operational} s, commit ${phases.commit} s; ${output.requestSeconds} s in requests; peak memory ${output.peakMemoryMb} MB`,
  ];
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
    `  changed on the instance: ${changes.changedSources.join(", ") || "nothing"}`,
    ...warning,
    load(output),
  ];
}

export function renderPull(output: PullOutput): string {
  const lines = output.incremental
    ? renderIncremental(output, output.incremental)
    : output.full
      ? renderFull(output, output.full)
      : [];
  const unreadable = output.unreadable.length === 0 ? "none" : output.unreadable.join(", ");
  return [
    ...lines,
    `  not readable by this user: ${unreadable}`,
    ...(output.changed ? [`next: snagentic integrate ${output.instance}`] : []),
  ].join("\n");
}
