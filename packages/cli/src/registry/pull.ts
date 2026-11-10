import {
  getInstance,
  InstanceName,
  type InstanceProfile,
  minutesSince,
  type PullOutcome,
  type PullPorts,
  pullInstance,
  type SharedPullFacts,
} from "@snagentic/core";
import { z } from "zod";
import { fullOutput, incrementalOutput, PullOutput } from "./pull-output";
import { renderPull } from "./pull-render";
import type { SharedPullOutput } from "./pull-shared-output";
import { defineUseCase, type RunControl, type UseCaseContext } from "./use-case";
import { tuneClone, workspaceRoot } from "./workspace-root";

const PullInput = z.object({
  instance: z.string(),
  full: z.boolean().default(false).describe("pull everything again"),
  verify: z
    .boolean()
    .default(false)
    .describe("also compare the mirror with the instance by counts and repair differences"),
  now: z
    .boolean()
    .default(false)
    .describe(
      "pull from the instance even when the shared mirror is younger than its max age, or stale and published by another user",
    ),
  publish: z
    .boolean()
    .default(false)
    .describe(
      "push the mirror branch to the shared mirror after the pull (the designated puller; fast-forward only)",
    ),
  cost: z
    .boolean()
    .default(false)
    .describe(
      "also measure the run's server cost from the instance's transaction log (development instances only)",
    ),
});

function sharedView(facts: SharedPullFacts, now: Date): SharedPullOutput {
  const { start, setting, published } = facts;
  return {
    remote: start.remote,
    from: start.from,
    sharedCommit: start.shared?.commit ?? null,
    ageMinutes: start.watermark === null ? null : minutesSince(start.watermark, now),
    maxAgeMinutes: setting.maxAgeMinutes,
    publisher: start.shared?.state?.pulledBy ?? null,
    published,
  };
}

// The pull asked the instance nothing: the mirror is younger than maxAge (ADR-0052 item 3), or
// older and another user publishes it (A2).
function skippedOutput(
  name: string,
  mode: "current" | "stale",
  commit: string,
  shared: SharedPullFacts,
  now: Date,
): PullOutput {
  return {
    instance: name,
    mode,
    resumed: false,
    commit,
    changed: false,
    records: 0,
    unreadable: [],
    secretRedactions: [],
    watermark: shared.start.watermark ?? "",
    requests: 0,
    retries: 0,
    semaphoreWaitMs: 0,
    peakConcurrency: 0,
    requestSeconds: 0,
    seconds: 0,
    peakMemoryMb: 0,
    timeouts: 0,
    serverCostRequested: false,
    serverCost: null,
    shared: sharedView(shared, now),
  };
}

function toOutput(name: string, outcome: PullOutcome, now: Date): PullOutput {
  if (outcome.mode === "current" || outcome.mode === "stale") {
    return skippedOutput(name, outcome.mode, outcome.commit, outcome.shared, now);
  }
  const output =
    outcome.mode === "full"
      ? fullOutput(outcome.facts, outcome.summary)
      : incrementalOutput(outcome.facts, outcome.summary);
  return outcome.shared === undefined
    ? output
    : { ...output, shared: sharedView(outcome.shared, now) };
}

// The pull's ports, bound to this workspace and instance.
function pullPorts(
  context: UseCaseContext,
  root: string,
  profile: InstanceProfile,
  run: RunControl,
): PullPorts {
  return {
    prepareClone: () => tuneClone(context, root, run),
    credentials: context.credentials,
    connect: (target, secret) => context.connections.open(target, secret),
    state: context.syncState(root, profile.name),
    mirror: (mode) => context.mirrors.open(root, profile.name, mode),
    spills: context.spills(root, profile.name),
    shared: context.sharedMirror,
    clock: context.clock,
    elapsed: () => performance.now(),
    memory: () => process.memoryUsage().rss,
    version: context.host.version,
  };
}

export const pull = defineUseCase({
  name: "pull",
  description:
    "Mirror an instance's metadata into the workspace's servicenow-remote/<name> branch. The " +
    "first pull is complete and resumable; later pulls fetch only what changed. With a shared " +
    "mirror, a pull continues from the newest of it and this clone's branch, and asks the " +
    "instance nothing while that mirror is younger than its max age, or, unless --now, while " +
    "it is older and another user publishes it (mode stale). Then run integrate to bring it " +
    "into the working branch.",
  input: PullInput,
  output: PullOutput,
  flags: { readOnly: false, destructive: false, requiresDevelopmentInstance: false },
  mcp: true,
  arguments: ["instance"],
  async handle(input, context, run) {
    const root = await workspaceRoot(context);
    const profile = await getInstance(root, InstanceName.parse(input.instance), context.profiles);
    const outcome = await pullInstance(
      pullPorts(context, root, profile, run),
      root,
      profile,
      input,
      run,
    );
    return toOutput(profile.name, outcome, context.clock());
  },
  render: renderPull,
  exitCode: () => 0,
});
