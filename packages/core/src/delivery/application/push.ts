import type { InstanceReader } from "../../connection/ports";
import type { NextCall } from "../../knowledge/index";
import { Catalog, type CatalogData } from "../../metadata/domain/catalog";
import { GLOBAL } from "../domain/batch";
import type { PlannedWrite } from "../domain/change";
import {
  PlanChangedError,
  PlanNotReadyError,
  PushConfirmationRequiredError,
  UnfinishedPushError,
} from "../domain/errors";
import type { InstanceWriter, PullRequests, PushJournal, PushJournalStore } from "../ports";
import { computePlan, type PlanDependencies, type PlanQuery } from "./plan-push";
import { type PullRequestOutcome, pullRequestFor } from "./pull-request";
import {
  captured,
  type InstanceSession,
  openBatch,
  openChild,
  restorePreference,
  switchPreference,
  userSysId,
  writeRecord,
} from "./push-steps";

export interface PushDependencies extends PlanDependencies {
  readonly reader: InstanceReader;
  readonly writer: InstanceWriter;
  readonly journal: PushJournalStore;
  readonly catalog: CatalogData;
  // The user the connection authenticates as: its current update set is switched.
  readonly username: string;
  // The instance's base URL, for links to the update sets.
  readonly url: string;
  // The git platform, for the branch's pull request (ADR-0022).
  readonly pullRequests: PullRequests;
}

export interface PushQuery extends PlanQuery {
  readonly planId: string;
  readonly confirm: boolean;
  // The branch's pull request, linked from the batch's description; looked up when absent.
  readonly pr?: string;
  // Open a draft pull request when the branch has none (ADR-0022).
  readonly draftPr?: boolean;
}

interface OpenedUpdateSet {
  readonly name: string;
  readonly sysId: string;
  readonly created: boolean;
  readonly link: string;
}

export interface PushResult {
  readonly instance: string;
  readonly planId: string;
  // The branch's batch (spec 004, D3); global changes are written into it.
  readonly batch: OpenedUpdateSet;
  readonly pullRequest: PullRequestOutcome;
  // The update set each scope's changes were written into.
  readonly updateSets: readonly (OpenedUpdateSet & { readonly scope: string })[];
  readonly written: readonly {
    operation: string;
    table: string;
    sysId: string;
    path: string;
    captured: boolean;
  }[];
  // Writes the platform did not record in the update set: they will not travel with it.
  readonly notCaptured: number;
  readonly next: readonly NextCall[];
}

// An interrupted push: put the user's update set back, then wait for a pull to show what
// reached the instance (spec 004, section 4).
async function recover(deps: PushDependencies, session: InstanceSession): Promise<void> {
  const unfinished = await deps.journal.read();
  if (unfinished === null) {
    return;
  }
  if (unfinished.preference !== null) {
    await restorePreference(session, unfinished.preference);
    await deps.journal.write({ ...unfinished, preference: null });
  }
  if ((await deps.workspace.mirrorCommit()) === unfinished.mirrorCommit) {
    throw new UnfinishedPushError(unfinished.planId);
  }
  await deps.journal.clear();
}

async function pushScope(
  deps: PushDependencies,
  session: InstanceSession,
  journal: { current: PushJournal },
  scope: { name: string; id: string; setId: string; user: string; writes: readonly PlannedWrite[] },
  catalog: Catalog,
) {
  const preferenceName = scope.id === "global" ? "sys_update_set" : `updateSetForScope${scope.id}`;
  const preference = await switchPreference(session, scope.user, preferenceName, scope.setId);
  const save = (next: PushJournal) => {
    journal.current = next;
    return deps.journal.write(next);
  };
  await save({ ...journal.current, preference });
  try {
    for (const write of scope.writes) {
      const step = { operation: write.operation, table: write.table, sysId: write.sysId };
      await save({
        ...journal.current,
        steps: [...journal.current.steps, { ...step, state: "sending" }],
      });
      await writeRecord(session, catalog, write, scope.id, journal.current.steps.length - 1);
      await save({
        ...journal.current,
        steps: journal.current.steps.map((s) =>
          s.sysId === write.sysId ? { ...s, state: "written" } : s,
        ),
      });
    }
  } finally {
    await restorePreference(session, preference);
    await save({ ...journal.current, preference: null });
  }
}

// Everything checked before the first write: confirmation, an interrupted push, and the plan
// being exactly the one the user reviewed, still ready.
async function preflight(deps: PushDependencies, query: PushQuery, session: InstanceSession) {
  if (!query.confirm) {
    throw new PushConfirmationRequiredError();
  }
  await recover(deps, session);
  const planned = await computePlan(deps, query);
  if (planned.plan.planId !== query.planId) {
    throw new PlanChangedError(query.planId, planned.plan.planId);
  }
  if (!planned.plan.ready) {
    throw new PlanNotReadyError();
  }
  return planned;
}

// The update set for each scope's writes: the batch for global, otherwise its child.
async function updateSetsFor(
  deps: PushDependencies,
  session: InstanceSession,
  plan: { readonly label: string; readonly scopes: readonly string[]; readonly pr?: string },
  catalog: Catalog,
) {
  const link = (set: { sysId: string }) => `${deps.url}/sys_update_set.do?sys_id=${set.sysId}`;
  const opened = await openBatch(session, plan.label, plan.pr);
  const batch = { ...opened, link: link(opened) };
  const sets: (OpenedUpdateSet & { scope: string; id: string })[] = [];
  for (const scope of plan.scopes) {
    const id = catalog.scopeSysId(scope) ?? scope;
    const set =
      scope === GLOBAL
        ? batch
        : await openChild(session, plan.label, { name: scope, id }, batch.sysId);
    sets.push({ scope, id, ...set, link: link(set) });
  }
  return { batch, sets };
}

// Each scope's writes into its update set, each checked for capture afterwards.
async function writeAll(
  deps: PushDependencies,
  session: InstanceSession,
  journal: { current: PushJournal },
  run: {
    readonly sets: readonly { id: string; scope: string; sysId: string }[];
    readonly writes: readonly PlannedWrite[];
    readonly user: string;
  },
  catalog: Catalog,
) {
  const written: PushResult["written"][number][] = [];
  for (const { id, scope, sysId } of run.sets) {
    const scoped = run.writes.filter((w) => w.scope === scope);
    const target = { name: scope, id, setId: sysId, user: run.user, writes: scoped };
    await pushScope(deps, session, journal, target, catalog);
    for (const write of scoped) {
      const { operation, table, sysId: record, path } = write;
      const done = await captured(session, write, sysId);
      written.push({ operation, table, sysId: record, path, captured: done });
    }
  }
  return written;
}

// Writes a reviewed plan to the development instance, into the branch's batch of update sets.
export async function push(deps: PushDependencies, query: PushQuery): Promise<PushResult> {
  const session: InstanceSession = {
    reader: deps.reader,
    writer: deps.writer,
    signal: deps.signal,
  };
  const { plan, writes } = await preflight(deps, query, session);
  const pullRequest = await pullRequestFor(deps, { ...query, label: plan.label, writes });
  const catalog = new Catalog(deps.catalog);
  const user = await userSysId(session, deps.username);
  const journal: { current: PushJournal } = {
    current: {
      planId: plan.planId,
      mirrorCommit: plan.mirrorCommit,
      startedAt: deps.now().toISOString(),
      preference: null,
      steps: [],
    },
  };
  await deps.journal.write(journal.current);
  const scopes = [...new Set(writes.map((w) => w.scope))].sort();
  const pr = "url" in pullRequest ? { pr: pullRequest.url } : {};
  const { batch, sets } = await updateSetsFor(deps, session, { ...plan, scopes, ...pr }, catalog);
  const written = await writeAll(deps, session, journal, { sets, writes, user }, catalog);
  await deps.journal.clear();
  return {
    instance: query.instance,
    planId: plan.planId,
    batch,
    pullRequest,
    updateSets: sets.map(({ id, ...set }) => set),
    written,
    notCaptured: written.filter((w) => !w.captured).length,
    next: [
      { tool: "pull", args: { instance: query.instance } },
      { tool: "status", args: { instance: query.instance } },
    ],
  };
}
