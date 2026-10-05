import {
  type ConnectionStats,
  DEFAULT_REDACTION,
  getInstance,
  InstanceName,
  instancePaths,
  KeysetPager,
  type PullSummary,
  pullFull,
  resolveSecret,
  SnagenticError,
} from "@snagentic/core";
import { z } from "zod";
import { defineUseCase, type ProgressEvent, type RunControl } from "./use-case";
import { workspaceRoot } from "./workspace-root";

class IncrementalNotYetError extends SnagenticError {
  constructor(instance: string) {
    super(
      "incremental-not-available",
      "usage",
      `${instance} has been pulled already; incremental pulls arrive in milestone M4`,
      `run: snagentic pull ${instance} --full`,
    );
  }
}

const Output = z.object({
  instance: z.string(),
  mode: z.literal("full"),
  resumed: z.boolean(),
  commit: z.string(),
  classes: z.number(),
  records: z.number(),
  childRows: z.number(),
  operationalRows: z.number(),
  skippedRows: z.number(),
  unreadable: z.array(z.string()),
  watermark: z.string(),
  requests: z.number(),
  retries: z.number(),
  semaphoreWaitMs: z.number(),
  seconds: z.number(),
  phaseSeconds: z.object({
    catalog: z.number(),
    records: z.number(),
    children: z.number(),
    operational: z.number(),
    commit: z.number(),
  }),
  peakConcurrency: z.number(),
  requestSeconds: z.number(),
  peakMemoryMb: z.number(),
});
type Output = z.output<typeof Output>;

const tenths = (milliseconds: number) => Math.round(milliseconds / 100) / 10;

// Resident memory, sampled whenever the pull reports progress (at least once per class).
function memorySampler(run: RunControl) {
  let peak = 0;
  const sample = () => {
    peak = Math.max(peak, process.memoryUsage().rss);
  };
  const progress = (event: ProgressEvent) => {
    sample();
    run.progress(event);
  };
  return { sample, progress, peakMb: () => Math.round(peak / 1024 / 1024) };
}

interface Timings {
  readonly started: number;
  readonly committing: number;
}

function report(
  name: string,
  resumed: boolean,
  commit: string,
  summary: PullSummary,
  stats: ConnectionStats,
  timings: Timings,
  peakMemoryMb: number,
): Output {
  const now = performance.now();
  return {
    instance: name,
    mode: "full",
    resumed,
    commit,
    ...summary,
    unreadable: [...summary.unreadable],
    requests: stats.requests,
    retries: stats.retries,
    semaphoreWaitMs: stats.semaphoreWaitMs,
    seconds: tenths(now - timings.started),
    phaseSeconds: { ...summary.phaseSeconds, commit: tenths(now - timings.committing) },
    peakConcurrency: stats.peakConcurrency,
    requestSeconds: tenths(stats.requestMs),
    peakMemoryMb,
  };
}

function render(output: Output): string {
  const unreadable = output.unreadable.length === 0 ? "none" : output.unreadable.join(", ");
  const phases = output.phaseSeconds;
  return [
    `pulled ${output.instance}${output.resumed ? " (resumed)" : ""} in ${output.seconds} s -> ${output.commit.slice(0, 10)} on servicenow-remote/${output.instance}`,
    `  ${output.records} records in ${output.classes} classes, ${output.childRows} child rows, ${output.operationalRows} inventory rows, ${output.skippedRows} skipped`,
    `  instance load: ${output.requests} requests, ${output.retries} retries, semaphore wait ${output.semaphoreWaitMs} ms, peak concurrency ${output.peakConcurrency}`,
    `  time: catalog ${phases.catalog} s, records ${phases.records} s, child rows ${phases.children} s, inventory ${phases.operational} s, commit ${phases.commit} s; ${output.requestSeconds} s in requests; peak memory ${output.peakMemoryMb} MB`,
    `  not readable by this user: ${unreadable}`,
    `next: snagentic integrate ${output.instance}`,
  ].join("\n");
}

export const pull = defineUseCase({
  name: "pull",
  description:
    "Mirror an instance's metadata into the workspace's servicenow-remote/<name> branch. The first " +
    "pull is complete and resumable; then run integrate to bring it into the working branch.",
  input: z.object({
    instance: z.string(),
    full: z.boolean().default(false).describe("pull everything again"),
  }),
  output: Output,
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: false },
  mcp: true,
  arguments: ["instance"],
  async handle(input, context, run) {
    const started = performance.now();
    const root = await workspaceRoot(context);
    const name = InstanceName.parse(input.instance);
    const profile = await getInstance(root, name, context.profiles);
    const state = context.syncState(root, name);
    const resumed = (await state.readCheckpoint()) !== null;
    if (!input.full && !resumed && (await state.readState()) !== null) {
      throw new IncrementalNotYetError(name);
    }
    const reader = context.connections.open(
      profile,
      await resolveSecret(profile, context.credentials),
    );
    const mirror = await context.mirrors.open(root, name, resumed);
    const paths = instancePaths(name);
    const memory = memorySampler(run);
    const deps = {
      pager: new KeysetPager(reader),
      records: mirror,
      state,
      metadataRoot: paths.metadata,
      operationalRoot: paths.operational,
      policy: DEFAULT_REDACTION,
      now: context.clock,
    };
    try {
      const summary = await pullFull(deps, run.signal, memory.progress);
      const committing = performance.now();
      const commit = await mirror.finish(
        `snagentic pull ${name}: full (${summary.records} records, ${summary.childRows} child rows)`,
      );
      memory.sample();
      return report(
        name,
        resumed,
        commit,
        summary,
        reader.stats(),
        { started, committing },
        memory.peakMb(),
      );
    } catch (error) {
      await mirror.abort();
      throw error;
    }
  },
  render,
  exitCode: () => 0,
});
