import {
  DEFAULT_REDACTION,
  getInstance,
  InstanceName,
  instancePaths,
  KeysetPager,
  pullFull,
  resolveSecret,
  SnagenticError,
} from "@snagentic/core";
import { z } from "zod";
import { defineUseCase } from "./use-case";
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

const Summary = z.object({
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
});

export const pull = defineUseCase({
  name: "pull",
  description:
    "Mirror an instance's metadata into the workspace's servicenow-remote/<name> branch. The first " +
    "pull is complete and resumable; then run integrate to bring it into the working branch.",
  input: z.object({
    instance: z.string(),
    full: z.boolean().default(false).describe("pull everything again"),
  }),
  output: Summary,
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
    try {
      const summary = await pullFull(
        {
          pager: new KeysetPager(reader),
          records: mirror,
          state,
          metadataRoot: paths.metadata,
          operationalRoot: paths.operational,
          policy: DEFAULT_REDACTION,
          now: context.clock,
        },
        run.signal,
        run.progress,
      );
      const commit = await mirror.finish(
        `snagentic pull ${name}: full (${summary.records} records, ${summary.childRows} child rows)`,
      );
      const stats = reader.stats();
      return {
        instance: name,
        mode: "full" as const,
        resumed,
        commit,
        ...summary,
        unreadable: [...summary.unreadable],
        requests: stats.requests,
        retries: stats.retries,
        semaphoreWaitMs: stats.semaphoreWaitMs,
        seconds: Math.round((performance.now() - started) / 100) / 10,
      };
    } catch (error) {
      await mirror.abort();
      throw error;
    }
  },
  render(output) {
    const unreadable = output.unreadable.length === 0 ? "none" : output.unreadable.join(", ");
    return [
      `pulled ${output.instance}${output.resumed ? " (resumed)" : ""} in ${output.seconds} s -> ${output.commit.slice(0, 10)} on servicenow-remote/${output.instance}`,
      `  ${output.records} records in ${output.classes} classes, ${output.childRows} child rows, ${output.operationalRows} inventory rows, ${output.skippedRows} skipped`,
      `  instance load: ${output.requests} requests, ${output.retries} retries, semaphore wait ${output.semaphoreWaitMs} ms`,
      `  not readable by this user: ${unreadable}`,
      `next: snagentic integrate ${output.instance}`,
    ].join("\n");
  },
  exitCode: () => 0,
});
