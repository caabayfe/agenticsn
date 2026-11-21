import {
  type ConnectionStats,
  type InstanceReader,
  measureServerCost,
  type ServerCost,
  type ServerCostReader,
  type TableStatistics,
} from "../../connection/index";
import {
  type CredentialStore,
  type InstanceProfile,
  resolveSecret,
  verifyReadOnlyCredential,
} from "../../instance/index";
import type { InstanceName } from "../../kernel/instance-name";
import { DEFAULT_REDACTION } from "../../metadata/domain/redaction";
import { instancePaths } from "../../workspace/index";
import { VerifyNeedsPullError } from "../domain/pull-errors";
import { isLater, removesByAbsence } from "../domain/pull-state";
import type {
  FinishedPull,
  IncrementalMirror,
  MirrorMode,
  SharedMirror,
  SpillStore,
  SyncState,
  SyncStateStore,
} from "../ports";
import type { IncrementalDependencies } from "./incremental-dependencies";
import { KeysetPager } from "./keyset-pager";
import { type PullProgress, rawTimestamp } from "./pull-dependencies";
import { type PullSummary, pullFull } from "./pull-full";
import { type IncrementalSummary, pullIncremental } from "./pull-incremental";
import { completePull, recordPull, stateInMirror } from "./pull-state";

// What a pull reads through its connection to the instance.
export type PullConnection = InstanceReader & TableStatistics & ServerCostReader;

// The ports one pull of an instance needs, bound to one workspace and instance.
export interface PullPorts {
  // Readies this clone's git for the pull (large-repository tuning); after the first progress line.
  readonly prepareClone: () => Promise<void>;
  readonly credentials: CredentialStore;
  readonly connect: (profile: InstanceProfile, secret: string) => PullConnection;
  readonly state: SyncStateStore;
  readonly mirror: (mode: MirrorMode) => Promise<IncrementalMirror>;
  readonly spills: SpillStore;
  readonly shared: SharedMirror;
  readonly clock: () => Date;
  // Milliseconds from a monotonic clock, for durations.
  readonly elapsed: () => number;
  // This process's resident memory in bytes.
  readonly memory: () => number;
  // The snagentic version the pull state records.
  readonly version: string;
}

export interface PullRequest {
  readonly full: boolean;
  readonly verify: boolean;
  readonly publish: boolean;
  // Measure the server cost from the transaction log (development only; ADR-0053).
  readonly cost: boolean;
}

export interface PullRun {
  readonly signal: AbortSignal;
  progress(event: PullProgress): void;
}

export interface RunFacts {
  readonly instance: string;
  readonly resumed: boolean;
  readonly commit: string;
  readonly changed: boolean;
  readonly stats: ConnectionStats;
  readonly elapsedMs: number;
  readonly commitMs: number;
  readonly peakMemoryMb: number;
  readonly serverCostRequested: boolean;
  readonly serverCost: ServerCost | null;
  // What went wrong after the mirror commit without costing it anything (housekeeping).
  readonly warnings: readonly string[];
}

// One pull from the instance, as it ran.
export type InstancePull =
  | { readonly mode: "full"; readonly facts: RunFacts; readonly summary: PullSummary }
  | {
      readonly mode: "incremental";
      readonly facts: RunFacts;
      readonly summary: IncrementalSummary;
    };

// Resident memory, sampled whenever the pull reports progress (at least once per class).
function memorySampler(ports: PullPorts, run: PullRun) {
  let peak = 0;
  const sample = () => {
    peak = Math.max(peak, ports.memory());
  };
  const progress = (event: PullProgress) => {
    sample();
    run.progress(event);
  };
  return { sample, progress, peakMb: () => Math.round(peak / 1024 / 1024) };
}

// Whether an interrupted full pull is left to continue. A checkpoint that started no later than
// the full pull the mirror already holds is that pull's own, left by a run that stopped between
// committing the mirror and clearing it (or an older pull's the mirror has overtaken). Resuming it
// would skip every class it lists as done on a tree that no longer holds its progress, so it is
// dropped and the pull continues from the mirror.
async function interrupted(state: SyncStateStore, pulled: SyncState | null): Promise<boolean> {
  const checkpoint = await state.readCheckpoint();
  if (checkpoint === null) {
    return false;
  }
  if (pulled === null || isLater(checkpoint.startedAt, pulled.lastFullPull)) {
    return true;
  }
  await state.clearCheckpoint();
  return false;
}

// A pull continues an interrupted full pull, pulls changes once a full pull exists, or starts
// from scratch when asked to (--full) or when nothing was pulled yet. The state it continues
// from is the mirror tip's (ADR-0052).
async function openSession(
  ports: PullPorts,
  profile: InstanceProfile,
  input: PullRequest,
  signal: AbortSignal,
) {
  const name = profile.name;
  const pulled = await ports.state.readState();
  const resumed = await interrupted(ports.state, pulled);
  const mode: MirrorMode = resumed
    ? "resume"
    : !input.full && pulled !== null
      ? "incremental"
      : "fresh";
  if (input.verify && mode !== "incremental") {
    throw new VerifyNeedsPullError(name);
  }
  const reader = ports.connect(profile, await resolveSecret(profile, ports.credentials));
  await verifyReadOnlyCredential(profile, reader, signal);
  const mirror = await ports.mirror(mode);
  // The pull holds the workspace lock, so any spill found now was left by a crashed run.
  await ports.spills.sweep();
  const paths = instancePaths(name);
  const user = profile.auth.username;
  const deps: IncrementalDependencies = {
    pager: new KeysetPager(reader),
    statistics: reader,
    records: mirror,
    state: stateInMirror(ports.state, mirror, paths.root),
    instanceRoot: paths.root,
    metadataRoot: paths.metadata,
    operationalRoot: paths.operational,
    catalogPath: paths.pullCatalog,
    policy: DEFAULT_REDACTION,
    now: ports.clock,
    spills: ports.spills,
    absence: removesByAbsence(pulled?.pulledBy, user) ? "remove" : "keep",
    instanceTime: () => reader.instanceTime?.() ?? null,
  };
  const puller = { user, version: ports.version };
  return { name, mode, reader, mirror, deps, puller };
}

// One pull from the instance into servicenow-remote/<name>, committed with its state.
export async function pullFromInstance(
  ports: PullPorts,
  profile: InstanceProfile,
  input: PullRequest,
  run: PullRun,
): Promise<InstancePull> {
  const started = ports.elapsed();
  // The transaction log is searched from a little before the start, so a skewed local
  // clock cannot hide requests; the run tag in the User-Agent does the matching.
  const since = rawTimestamp(new Date(ports.clock().getTime() - 5 * 60_000));
  const session = await openSession(ports, profile, input, run.signal);
  const memory = memorySampler(ports, run);
  const facts = async (finished: FinishedPull, committing: number): Promise<RunFacts> => {
    // Last, with the checkpoint already cleared: a pull that stops while packing has finished.
    const warning = await session.mirror.compact();
    memory.sample();
    // Read before measuring, so the measuring request is not counted as part of the pull.
    const stats = session.reader.stats();
    const serverCost = input.cost
      ? await measureServerCost(session.reader, since, run.signal)
      : null;
    const now = ports.elapsed();
    return {
      instance: session.name,
      resumed: session.mode === "resume",
      commit: finished.commit,
      changed: finished.created,
      stats,
      elapsedMs: now - started,
      commitMs: now - committing,
      peakMemoryMb: memory.peakMb(),
      serverCostRequested: input.cost,
      serverCost,
      warnings: warning === null ? [] : [warning],
    };
  };
  const { deps, mirror, name, puller } = session;
  try {
    if (session.mode === "incremental") {
      const summary = await pullIncremental(deps, name, run.signal, memory.progress, {
        verify: input.verify,
      });
      const committing = ports.elapsed();
      const record = { full: false, idle: summary.idle, publish: input.publish, puller };
      const carried = await recordPull(deps.state, summary.next, record);
      const finished = await mirror.finish(commitMessage(name, summary.changedSources));
      await completePull(deps.state, carried);
      return { mode: "incremental", facts: await facts(finished, committing), summary };
    }
    const summary = await pullFull(deps, run.signal, memory.progress);
    const committing = ports.elapsed();
    await recordPull(deps.state, summary.next, { full: true, idle: false, puller });
    const finished = await mirror.finish(
      `snagentic pull ${name}: full (${summary.records} records, ${summary.childRows} child rows)`,
    );
    await completePull(deps.state, true);
    return { mode: "full", facts: await facts(finished, committing), summary };
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
