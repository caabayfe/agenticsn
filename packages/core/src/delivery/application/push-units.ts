import type { LedgerEntry } from "../../authoring/domain/ledger";
import { LEDGER_FILE, withEntries } from "../../authoring/domain/ledger";
import type { InstanceReader } from "../../connection/ports";
import type { NextCall } from "../../knowledge/index";
import { GLOBAL } from "../domain/batch";
import {
  PlanChangedError,
  PlanNotReadyError,
  PushConfirmationRequiredError,
} from "../domain/errors";
import type {
  DeliveryWorkspace,
  FluentInstaller,
  InstanceWriter,
  PullRequests,
  PushJournal,
  PushJournalStore,
  SwitchedPreference,
} from "../ports";
import {
  computeUnitPlan,
  type ProjectLoad,
  type UnitPlanDependencies,
  type UnitPlanQuery,
} from "./plan-units";
import { type PullRequestOutcome, pullRequestFor } from "./pull-request";
import { settle, switchFor } from "./push-preferences";
import { type ProjectRun, type PushedUnit, pushProject } from "./push-project";
import { type InstanceSession, openBatch, restorePreference, userSysId } from "./push-steps";

// Loads a reviewed plan into the development instance, into the branch's batch of update sets
// (ADR-0031 item 4), then commits the ledgers of what now agrees with source (ADR-0033 item 3).

export interface UnitPushDependencies extends UnitPlanDependencies {
  readonly reader: InstanceReader;
  readonly writer: InstanceWriter;
  readonly journal: PushJournalStore;
  readonly workspace: DeliveryWorkspace;
  // The user the connection authenticates as: its preferences are switched, then restored.
  readonly username: string;
  // The instance's base URL, for links to the update sets.
  readonly url: string;
  readonly pullRequests: PullRequests;
  readonly installer: FluentInstaller;
}

export interface UnitPushQuery extends UnitPlanQuery {
  readonly planId: string;
  readonly confirm: boolean;
  readonly pr?: string;
  readonly draftPr?: boolean;
}

interface OpenedUpdateSet {
  readonly name: string;
  readonly sysId: string;
  readonly created: boolean;
  readonly link: string;
}

export interface UnitPushResult {
  readonly instance: string;
  readonly planId: string;
  readonly batch: OpenedUpdateSet;
  readonly pullRequest: PullRequestOutcome;
  readonly updateSets: readonly (OpenedUpdateSet & { readonly scope: string })[];
  readonly units: readonly PushedUnit[];
  // Loads the platform did not record in the update set: they will not travel with it.
  readonly notCaptured: number;
  // Units that, read back, do not hold what the build loaded: their ledger entry is unchanged.
  readonly notApplied: number;
  // The commit of the ledgers, or null when no ledger changed.
  readonly ledgerCommit: string | null;
  readonly next: readonly NextCall[];
}

// An interrupted push: put the user's preferences back. What reached the instance needs no
// journal: plan finds units the instance already holds and only records them.
async function recover(deps: UnitPushDependencies, session: InstanceSession): Promise<void> {
  const unfinished = await deps.journal.read();
  if (unfinished === null) return;
  for (const preference of [...unfinished.preferences].reverse()) {
    await restorePreference(session, preference);
  }
  await deps.journal.clear();
}

async function preflight(
  deps: UnitPushDependencies,
  query: UnitPushQuery,
  session: InstanceSession,
) {
  if (!query.confirm) throw new PushConfirmationRequiredError();
  await recover(deps, session);
  const planned = await computeUnitPlan(deps, query);
  if (planned.plan.planId !== query.planId) {
    throw new PlanChangedError(query.planId, planned.plan.planId);
  }
  if (!planned.plan.ready) throw new PlanNotReadyError();
  return planned;
}

// The branch's batch, a global update set: opened while global is the current application,
// as the platform creates an update set in the current application (ADR-0025).
async function openGlobalBatch(
  deps: UnitPushDependencies,
  session: InstanceSession,
  journal: { current: PushJournal },
  run: { readonly label: string; readonly user: string; readonly pr: string | undefined },
): Promise<OpenedUpdateSet> {
  const save = (preferences: readonly SwitchedPreference[]) => {
    journal.current = { ...journal.current, preferences };
    return deps.journal.write(journal.current);
  };
  try {
    await switchFor(
      session,
      { user: run.user, name: "apps.current_app", value: GLOBAL },
      journal,
      save,
    );
    const opened = await openBatch(session, run.label, run.pr);
    await settle(session, journal, save);
    return { ...opened, link: `${deps.url}/sys_update_set.do?sys_id=${opened.sysId}` };
  } catch (error) {
    await settle(session, journal, save).catch(() => {});
    throw error;
  }
}

// Global first: it holds new applications (S17 G2), whose own update sets need them to exist.
const pushOrder = (loads: readonly ProjectLoad[]) =>
  [...loads]
    .filter((load) => load.units.length > 0)
    .sort((a, b) =>
      a.project.scopeId === GLOBAL
        ? -1
        : b.project.scopeId === GLOBAL
          ? 1
          : a.project.path < b.project.path
            ? -1
            : 1,
    );

// Writes each project's new ledger, and commits them together.
async function commitLedgers(
  deps: UnitPushDependencies,
  instance: string,
  planId: string,
  changes: readonly {
    readonly load: ProjectLoad;
    readonly ledger: ReadonlyMap<string, LedgerEntry | undefined>;
  }[],
): Promise<string | null> {
  const paths: string[] = [];
  for (const { load, ledger } of changes) {
    if (ledger.size === 0) continue;
    await deps.authoring.workspace.writeLedger(
      load.project,
      withEntries(load.ledger, instance, ledger),
    );
    paths.push(`${load.project.path}/${LEDGER_FILE}`);
  }
  if (paths.length === 0) return null;
  return deps.workspace.commitFiles(
    paths,
    `chore(snagentic): ledger after push ${planId} to ${instance}`,
  );
}

// Each project in turn, into its update set.
async function pushAll(deps: UnitPushDependencies, run: ProjectRun, loads: readonly ProjectLoad[]) {
  const updateSets: UnitPushResult["updateSets"][number][] = [];
  const units: PushedUnit[] = [];
  const ledgers: { load: ProjectLoad; ledger: ReadonlyMap<string, LedgerEntry | undefined> }[] = [];
  for (const load of pushOrder(loads)) {
    const pushed = await pushProject(run, load);
    const link = `${deps.url}/sys_update_set.do?sys_id=${pushed.updateSet.sysId}`;
    updateSets.push({ scope: load.project.scope, ...pushed.updateSet, link });
    units.push(...pushed.units);
    ledgers.push({ load, ledger: pushed.ledger });
  }
  return { updateSets, units, ledgers };
}

export async function pushUnits(
  deps: UnitPushDependencies,
  query: UnitPushQuery,
): Promise<UnitPushResult> {
  const session: InstanceSession = {
    reader: deps.reader,
    writer: deps.writer,
    signal: deps.signal,
  };
  const { plan, loads } = await preflight(deps, query, session);
  const pullRequest = await pullRequestFor(deps, {
    label: plan.label,
    ...(query.pr === undefined ? {} : { pr: query.pr }),
    ...(query.draftPr === undefined ? {} : { draftPr: query.draftPr }),
  });
  const user = await userSysId(session, deps.username);
  const startedAt = deps.now().toISOString();
  const journal: { current: PushJournal } = {
    current: { planId: plan.planId, mirrorCommit: "", startedAt, preferences: [], steps: [] },
  };
  await deps.journal.write(journal.current);
  const pr = "url" in pullRequest ? pullRequest.url : undefined;
  const batch = await openGlobalBatch(deps, session, journal, { label: plan.label, user, pr });
  const { installer, username, now } = deps;
  const run: ProjectRun = {
    session,
    installer,
    journal,
    store: deps.journal,
    username,
    user,
    label: plan.label,
    batch,
    now,
  };
  const { updateSets, units, ledgers } = await pushAll(deps, run, loads);
  await deps.journal.clear();
  const ledgerCommit = await commitLedgers(deps, query.instance, plan.planId, ledgers);
  return {
    instance: query.instance,
    planId: plan.planId,
    batch,
    pullRequest,
    updateSets,
    units,
    notCaptured: units.filter((u) => !u.captured).length,
    notApplied: units.filter((u) => !u.applied).length,
    ledgerCommit,
    next: [{ tool: "status", args: { instance: query.instance } }],
  };
}
