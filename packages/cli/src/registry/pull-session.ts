import {
  completePull,
  DEFAULT_REDACTION,
  type FinishedPull,
  type IncrementalDependencies,
  type InstanceName,
  type InstanceProfile,
  instancePaths,
  KeysetPager,
  type MirrorMode,
  measureServerCost,
  pullFull,
  pullIncremental,
  rawTimestamp,
  recordPull,
  removesByAbsence,
  resolveSecret,
  SnagenticError,
  stateInMirror,
  verifyReadOnlyCredential,
} from "@snagentic/core";
import { fullOutput, incrementalOutput, type PullOutput, type RunFacts } from "./pull-output";
import type { ProgressEvent, RunControl, UseCaseContext } from "./use-case";

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

export interface PullRequest {
  readonly full: boolean;
  readonly verify: boolean;
  readonly publish: boolean;
  // Measure the server cost from the transaction log (development only; ADR-0053).
  readonly cost: boolean;
}

// A pull continues an interrupted full pull, pulls changes once a full pull exists, or starts
// from scratch when asked to (--full) or when nothing was pulled yet. The state it continues
// from is the mirror tip's (ADR-0052).
async function openSession(
  root: string,
  profile: InstanceProfile,
  input: PullRequest,
  context: UseCaseContext,
  signal: AbortSignal,
) {
  const name = profile.name;
  const state = context.syncState(root, name);
  const resumed = (await state.readCheckpoint()) !== null;
  const pulled = await state.readState();
  const mode: MirrorMode = resumed
    ? "resume"
    : !input.full && pulled !== null
      ? "incremental"
      : "fresh";
  if (input.verify && mode !== "incremental") {
    throw new VerifyNeedsPullError(name);
  }
  const reader = context.connections.open(
    profile,
    await resolveSecret(profile, context.credentials),
  );
  await verifyReadOnlyCredential(profile, reader, signal);
  const mirror = await context.mirrors.open(root, name, mode);
  // The pull holds the workspace lock, so any spill found now was left by a crashed run.
  const spills = context.spills(root, name);
  await spills.sweep();
  const paths = instancePaths(name);
  const user = profile.auth.username;
  const deps: IncrementalDependencies = {
    pager: new KeysetPager(reader),
    statistics: reader,
    records: mirror,
    state: stateInMirror(state, mirror, paths.root),
    instanceRoot: paths.root,
    metadataRoot: paths.metadata,
    operationalRoot: paths.operational,
    catalogPath: paths.pullCatalog,
    policy: DEFAULT_REDACTION,
    now: context.clock,
    spills,
    absence: removesByAbsence(pulled?.pulledBy, user) ? "remove" : "keep",
    instanceTime: () => reader.instanceTime?.() ?? null,
  };
  const puller = { user, version: context.host.version };
  return { name, mode, reader, mirror, deps, puller };
}

// One pull from the instance into servicenow-remote/<name>, committed with its state.
export async function pullFromInstance(
  root: string,
  profile: InstanceProfile,
  input: PullRequest,
  context: UseCaseContext,
  run: RunControl,
): Promise<PullOutput> {
  const started = performance.now();
  // The transaction log is searched from a little before the start, so a skewed local
  // clock cannot hide requests; the run tag in the User-Agent does the matching.
  const since = rawTimestamp(new Date(context.clock().getTime() - 5 * 60_000));
  const session = await openSession(root, profile, input, context, run.signal);
  const memory = memorySampler(run);
  const facts = async (finished: FinishedPull, committing: number): Promise<RunFacts> => {
    memory.sample();
    // Read before measuring, so the measuring request is not counted as part of the pull.
    const stats = session.reader.stats();
    return {
      instance: session.name,
      resumed: session.mode === "resume",
      commit: finished.commit,
      changed: finished.created,
      stats,
      started,
      committing,
      peakMemoryMb: memory.peakMb(),
      serverCostRequested: input.cost,
      serverCost: input.cost ? await measureServerCost(session.reader, since, run.signal) : null,
    };
  };
  const { deps, mirror, name, puller } = session;
  try {
    if (session.mode === "incremental") {
      const summary = await pullIncremental(deps, name, run.signal, memory.progress, {
        verify: input.verify,
      });
      const committing = performance.now();
      const record = { full: false, idle: summary.idle, publish: input.publish, puller };
      const carried = await recordPull(deps.state, summary.next, record);
      const finished = await mirror.finish(commitMessage(name, summary.changedSources));
      await completePull(deps.state, carried);
      return incrementalOutput(await facts(finished, committing), summary);
    }
    const summary = await pullFull(deps, run.signal, memory.progress);
    const committing = performance.now();
    await recordPull(deps.state, summary.next, { full: true, idle: false, puller });
    const finished = await mirror.finish(
      `snagentic pull ${name}: full (${summary.records} records, ${summary.childRows} child rows)`,
    );
    await completePull(deps.state, true);
    return fullOutput(await facts(finished, committing), summary);
  } catch (error) {
    await mirror.abort();
    throw error;
  }
}

function commitMessage(name: InstanceName, sources: readonly string[]): string {
  return sources.length === 0
    ? `snagentic pull ${name}: no changes`
    : `snagentic pull ${name}: changes in ${sources.join(", ")}`;
}
