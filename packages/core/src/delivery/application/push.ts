import type { InstanceReader } from "../../connection/ports";
import type { NextCall } from "../../knowledge/index";
import { Catalog, type CatalogData } from "../../metadata/domain/catalog";
import type { PlannedWrite } from "../domain/change";
import {
  PlanChangedError,
  PlanNotReadyError,
  PushConfirmationRequiredError,
  UnfinishedPushError,
} from "../domain/errors";
import type { InstanceWriter, PushJournal, PushJournalStore } from "../ports";
import { computePlan, type PlanDependencies, type PlanQuery } from "./plan-push";
import {
  captured,
  type InstanceSession,
  openUpdateSet,
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
}

export interface PushQuery extends PlanQuery {
  readonly planId: string;
  readonly confirm: boolean;
}

export interface PushResult {
  readonly instance: string;
  readonly planId: string;
  readonly updateSets: readonly {
    scope: string;
    name: string;
    sysId: string;
    created: boolean;
    link: string;
  }[];
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

// Writes a reviewed plan to the development instance, into one update set per scope.
export async function push(deps: PushDependencies, query: PushQuery): Promise<PushResult> {
  const session: InstanceSession = {
    reader: deps.reader,
    writer: deps.writer,
    signal: deps.signal,
  };
  const { plan, writes } = await preflight(deps, query, session);
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
  const updateSets: PushResult["updateSets"][number][] = [];
  const written: PushResult["written"][number][] = [];
  for (const scope of [...new Set(writes.map((w) => w.scope))].sort()) {
    const id = catalog.scopeSysId(scope) ?? scope;
    const set = await openUpdateSet(session, `snagentic: ${plan.label} [${scope}]`, id);
    updateSets.push({ scope, ...set, link: `${deps.url}/sys_update_set.do?sys_id=${set.sysId}` });
    const scoped = writes.filter((w) => w.scope === scope);
    await pushScope(
      deps,
      session,
      journal,
      { name: scope, id, setId: set.sysId, user, writes: scoped },
      catalog,
    );
    for (const write of scoped) {
      const { operation, table, sysId, path } = write;
      written.push({
        operation,
        table,
        sysId,
        path,
        captured: await captured(session, write, set.sysId),
      });
    }
  }
  await deps.journal.clear();
  return {
    instance: query.instance,
    planId: plan.planId,
    updateSets,
    written,
    notCaptured: written.filter((w) => !w.captured).length,
    next: [
      { tool: "pull", args: { instance: query.instance } },
      { tool: "status", args: { instance: query.instance } },
    ],
  };
}
