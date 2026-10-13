import type { InstanceReader } from "../../connection/ports";
import type { NextCall } from "../../knowledge/index";
import { Catalog, type CatalogData } from "../../metadata/domain/catalog";
import { GLOBAL } from "../domain/batch";
import { needsElevation, type PlannedWrite } from "../domain/change";
import {
  PlanChangedError,
  PlanNotReadyError,
  PushConfirmationRequiredError,
  UnfinishedPushError,
} from "../domain/errors";
import type {
  ElevatedSessions,
  InstanceWriter,
  PullRequests,
  PushJournal,
  PushJournalStore,
  SwitchedPreference,
} from "../ports";
import { ensureElevationAvailable } from "./elevated-writes";
import { computePlan, type PlanDependencies, type PlanQuery } from "./plan-push";
import { type PullRequestOutcome, pullRequestFor } from "./pull-request";
import { settle, switchFor } from "./push-preferences";
import { pushScope } from "./push-scope";
import {
  captured,
  type InstanceSession,
  openBatch,
  restorePreference,
  userSysId,
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
  // Opens sessions elevated to security_admin for ACLs; null unless opted in (ADR-0024).
  readonly elevatedSessions: ElevatedSessions | null;
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
    // Written through a session elevated to security_admin (ADR-0024).
    elevated: boolean;
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
  if (unfinished.preferences.length > 0) {
    for (const preference of [...unfinished.preferences].reverse()) {
      await restorePreference(session, preference);
    }
    await deps.journal.write({ ...unfinished, preferences: [] });
  }
  if ((await deps.workspace.mirrorCommit()) === unfinished.mirrorCommit) {
    throw new UnfinishedPushError(unfinished.planId);
  }
  await deps.journal.clear();
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
  ensureElevationAvailable(deps.elevatedSessions, planned.writes);
  return planned;
}

// A scope's sys_id: known from the last pull, or the sys_id of the application this push
// creates for it (ADR-0025), so its update set can be opened before the application exists.
function scopeId(catalog: Catalog, scope: string, writes: readonly PlannedWrite[]): string {
  const created = writes.find(
    (write) => write.table === "sys_app" && write.operation === "create" && write.scope === scope,
  );
  return catalog.scopeSysId(scope) ?? created?.sysId ?? scope;
}

// The branch's batch, a global update set: opened while global is the current application,
// as the platform creates an update set in the current application (ADR-0025).
async function openGlobalBatch(
  deps: PushDependencies,
  session: InstanceSession,
  journal: { current: PushJournal },
  run: { readonly label: string; readonly user: string; readonly pr: string | undefined },
): Promise<OpenedUpdateSet> {
  const save = (preferences: readonly SwitchedPreference[]) => {
    journal.current = { ...journal.current, preferences };
    return deps.journal.write(journal.current);
  };
  const current = { user: run.user, name: "apps.current_app", value: GLOBAL };
  try {
    await switchFor(session, current, journal, save);
    const opened = await openBatch(session, run.label, run.pr);
    return { ...opened, link: `${deps.url}/sys_update_set.do?sys_id=${opened.sysId}` };
  } catch (error) {
    await settle(session, null, journal, save).catch(() => {});
    throw error;
  }
}

// Each scope's writes into its update set (the batch for global, otherwise its child), each
// checked for capture afterwards.
async function writeAll(
  deps: PushDependencies,
  session: InstanceSession,
  journal: { current: PushJournal },
  run: {
    readonly label: string;
    readonly batch: OpenedUpdateSet;
    readonly writes: readonly PlannedWrite[];
    readonly user: string;
  },
  catalog: Catalog,
) {
  const link = (set: { sysId: string }) => `${deps.url}/sys_update_set.do?sys_id=${set.sysId}`;
  const written: PushResult["written"][number][] = [];
  const updateSets: PushResult["updateSets"][number][] = [];
  for (const scope of [...new Set(run.writes.map((w) => w.scope))].sort()) {
    const scoped = run.writes.filter((w) => w.scope === scope);
    const target = { name: scope, id: scopeId(catalog, scope, run.writes), user: run.user };
    const set = await pushScope(
      { deps, session, journal, catalog },
      { ...target, writes: scoped, label: run.label, batch: run.batch },
    );
    updateSets.push({ scope, ...set, link: link(set) });
    for (const write of scoped) {
      const { operation, table, sysId: record, path } = write;
      const done = await captured(session, write, set.sysId);
      const elevated = needsElevation(table);
      written.push({ operation, table, sysId: record, path, captured: done, elevated });
    }
  }
  return { written, updateSets };
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
      preferences: [],
      steps: [],
    },
  };
  await deps.journal.write(journal.current);
  const pr = "url" in pullRequest ? pullRequest.url : undefined;
  const batch = await openGlobalBatch(deps, session, journal, { label: plan.label, user, pr });
  const { written, updateSets } = await writeAll(
    deps,
    session,
    journal,
    { label: plan.label, batch, writes, user },
    catalog,
  );
  await deps.journal.clear();
  return {
    instance: query.instance,
    planId: plan.planId,
    batch,
    pullRequest,
    updateSets,
    written,
    notCaptured: written.filter((w) => !w.captured).length,
    next: [
      { tool: "pull", args: { instance: query.instance } },
      { tool: "status", args: { instance: query.instance } },
    ],
  };
}
