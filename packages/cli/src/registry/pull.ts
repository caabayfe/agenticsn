import {
  completePull,
  DEFAULT_REDACTION,
  type FinishedPull,
  getInstance,
  type IncrementalDependencies,
  InstanceName,
  instancePaths,
  KeysetPager,
  type MirrorMode,
  pullFull,
  pullIncremental,
  resolveSecret,
  SnagenticError,
} from "@snagentic/core";
import { z } from "zod";
import {
  fullOutput,
  incrementalOutput,
  PullOutput,
  type RunFacts,
  renderPull,
} from "./pull-output";
import {
  defineUseCase,
  type ProgressEvent,
  type RunControl,
  type UseCaseContext,
} from "./use-case";
import { workspaceRoot } from "./workspace-root";

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

// A pull continues an interrupted full pull, pulls changes once a full pull exists, or
// starts from scratch when asked to (--full) or when nothing was pulled yet.
class VerifyNeedsPullError extends SnagenticError {
  constructor(instance: string) {
    super(
      "verify-needs-pull",
      "usage",
      `--verify checks a completed pull, and ${instance} has none to check`,
      `run: snagentic pull ${instance}`,
    );
  }
}

async function openSession(
  input: { instance: string; full: boolean; verify: boolean },
  context: UseCaseContext,
) {
  const root = await workspaceRoot(context);
  const name = InstanceName.parse(input.instance);
  const profile = await getInstance(root, name, context.profiles);
  const state = context.syncState(root, name);
  const resumed = (await state.readCheckpoint()) !== null;
  const pulled = (await state.readState()) !== null;
  const mode: MirrorMode = resumed ? "resume" : !input.full && pulled ? "incremental" : "fresh";
  if (input.verify && mode !== "incremental") {
    throw new VerifyNeedsPullError(name);
  }
  const reader = context.connections.open(
    profile,
    await resolveSecret(profile, context.credentials),
  );
  const mirror = await context.mirrors.open(root, name, mode);
  const paths = instancePaths(name);
  const deps: IncrementalDependencies = {
    pager: new KeysetPager(reader),
    statistics: reader,
    records: mirror,
    state,
    metadataRoot: paths.metadata,
    operationalRoot: paths.operational,
    policy: DEFAULT_REDACTION,
    now: context.clock,
  };
  return { name, mode, reader, mirror, deps };
}

export const pull = defineUseCase({
  name: "pull",
  description:
    "Mirror an instance's metadata into the workspace's servicenow-remote/<name> branch. The " +
    "first pull is complete and resumable; later pulls fetch only what changed. Then run " +
    "integrate to bring it into the working branch.",
  input: z.object({
    instance: z.string(),
    full: z.boolean().default(false).describe("pull everything again"),
    verify: z
      .boolean()
      .default(false)
      .describe("also compare the mirror with the instance by counts and repair differences"),
  }),
  output: PullOutput,
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: false },
  mcp: true,
  arguments: ["instance"],
  async handle(input, context, run) {
    const started = performance.now();
    const session = await openSession(input, context);
    const memory = memorySampler(run);
    const facts = (finished: FinishedPull, committing: number): RunFacts => {
      memory.sample();
      return {
        instance: session.name,
        resumed: session.mode === "resume",
        commit: finished.commit,
        changed: finished.created,
        stats: session.reader.stats(),
        started,
        committing,
        peakMemoryMb: memory.peakMb(),
      };
    };
    const { deps, mirror, name } = session;
    try {
      if (session.mode === "incremental") {
        const summary = await pullIncremental(deps, name, run.signal, memory.progress, {
          verify: input.verify,
        });
        const committing = performance.now();
        const finished = await mirror.finish(
          `snagentic pull ${name}: changes in ${summary.changedSources.join(", ")}`,
        );
        await completePull(deps.state, summary.next);
        return incrementalOutput(facts(finished, committing), summary);
      }
      const summary = await pullFull(deps, run.signal, memory.progress);
      const committing = performance.now();
      const finished = await mirror.finish(
        `snagentic pull ${name}: full (${summary.records} records, ${summary.childRows} child rows)`,
      );
      await completePull(deps.state, summary.next);
      return fullOutput(facts(finished, committing), summary);
    } catch (error) {
      await mirror.abort();
      throw error;
    }
  },
  render: renderPull,
  exitCode: () => 0,
});
