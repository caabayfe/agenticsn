import {
  type IncrementalSummary,
  type PullSummary,
  type RunFacts,
  SECRET_PATTERN_IDS,
} from "@snagentic/core";
import { z } from "zod";
import { SharedPullOutput } from "./pull-shared-output";

export const PullOutput = z.object({
  instance: z.string(),
  // current: the shared mirror was younger than maxAge, and the instance was not asked.
  // stale: it was older, and another user publishes it; the instance was not asked either:
  // wait for the publisher's next pull, or pull --now (ADR-0052 A2).
  mode: z.enum(["full", "incremental", "current", "stale"]),
  resumed: z.boolean(),
  // The tip of servicenow-remote/<name>; unchanged when an incremental pull found nothing.
  commit: z.string(),
  changed: z.boolean(),
  records: z.number(),
  unreadable: z.array(z.string()),
  secretRedactions: z.array(
    z.object({
      path: z.string(),
      patterns: z.array(z.enum(SECRET_PATTERN_IDS)),
    }),
  ),
  watermark: z.string(),
  requests: z.number(),
  retries: z.number(),
  semaphoreWaitMs: z.number(),
  peakConcurrency: z.number(),
  requestSeconds: z.number(),
  seconds: z.number(),
  peakMemoryMb: z.number(),
  // Requests abandoned after the client's timeout (ADR-0053).
  timeouts: z.number(),
  // Whether the run measured its server cost (pull --cost, development only; ADR-0053).
  serverCostRequested: z.boolean(),
  // Server time this run's requests cost, from the instance's transaction log; null when not
  // requested or when the log cannot be read.
  serverCost: z
    .object({
      transactions: z.number(),
      responseMs: z.number(),
      maxResponseMs: z.number(),
      sqlMs: z.number(),
      sqlQueries: z.number(),
      cpuMs: z.number(),
      businessRuleMs: z.number(),
      aclMs: z.number(),
      semaphoreWaitMs: z.number(),
    })
    .nullable(),
  full: z
    .object({
      classes: z.number(),
      childRows: z.number(),
      operationalRows: z.number(),
      skippedRows: z.number(),
      malformedValues: z.number(),
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
      malformedValues: z.number(),
      rereadForRedaction: z.array(z.string()),
      childFiles: z.number(),
      removedChildFiles: z.number(),
      lostRecords: z.number(),
      inventoryRefreshed: z.array(z.string()),
      verification: z
        .object({
          scopes: z.number(),
          scopesDiffering: z.number(),
          countRequests: z.number(),
          listedRows: z.number(),
          hiddenRows: z.number(),
          unverifiable: z.number(),
          unmirrorable: z.number(),
          unlisted: z
            .array(z.object({ scope: z.string(), prefix: z.string(), records: z.number() }))
            .readonly(),
          recovered: z.number(),
          removed: z.number(),
        })
        .nullable(),
    })
    .optional(),
  shared: SharedPullOutput.optional(),
});
export type PullOutput = z.output<typeof PullOutput>;

const tenths = (milliseconds: number) => Math.round(milliseconds / 100) / 10;

function common(
  facts: RunFacts,
  summary: {
    unreadable: readonly string[];
    secretRedactions: PullSummary["secretRedactions"];
    watermark: string;
  },
) {
  return {
    instance: facts.instance,
    resumed: facts.resumed,
    commit: facts.commit,
    changed: facts.changed,
    unreadable: [...summary.unreadable],
    secretRedactions: summary.secretRedactions.map((redaction) => ({
      path: redaction.path,
      patterns: [...redaction.patterns],
    })),
    watermark: summary.watermark,
    requests: facts.stats.requests,
    retries: facts.stats.retries,
    semaphoreWaitMs: facts.stats.semaphoreWaitMs,
    peakConcurrency: facts.stats.peakConcurrency,
    requestSeconds: tenths(facts.stats.requestMs),
    seconds: tenths(facts.elapsedMs),
    peakMemoryMb: facts.peakMemoryMb,
    timeouts: facts.stats.timeouts,
    serverCostRequested: facts.serverCostRequested,
    serverCost: facts.serverCost,
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
      malformedValues: summary.malformedValues,
      phaseSeconds: {
        ...summary.phaseSeconds,
        commit: tenths(facts.commitMs),
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
      malformedValues: summary.malformedValues,
      rereadForRedaction: [...summary.rereadForRedaction],
      childFiles: summary.childFiles,
      removedChildFiles: summary.removedChildFiles,
      lostRecords: summary.lostRecords,
      inventoryRefreshed: [...summary.inventoryRefreshed],
      verification: summary.verification,
    },
  };
}
