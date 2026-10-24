import { deliveredDetail } from "../domain/earlier-sets";
import type { EnsureFact } from "../domain/ensure";
import {
  InstallBlockedError,
  InstallLockedError,
  InstallPlanChangedError,
  InstallStepStoppedError,
} from "../domain/errors";
import { installPlanDocument, installReportDocument } from "../domain/install-document";
import type { InstallPlan, InstallRecord, InstallStepRecord } from "../domain/install-plan";
import type { Adoption } from "../domain/materialize";
import type { RowProblem } from "../domain/row-problems";
import { ensureLayouts } from "./ensure-layouts";
import { components } from "./install-components";
import { type InstallRunDependencies, step } from "./install-step";
import { type InstallQuery, planInstall } from "./plan-install";

const folderOf = (pack: string, instance: string, planId: string) =>
  `accelerators/installs/${instance}/${pack}-${planId}`;

export interface InstallResult {
  readonly plan: InstallPlan;
  // Where the plan (and, after a run, the report) were written in the workspace.
  readonly planPath: string;
  readonly reportPath: string | null;
  readonly steps: readonly InstallStepRecord[];
  // The step that stopped the run, or null when it ran to the end (or only planned).
  readonly stopped: InstallStepRecord | null;
  readonly commit: string | null;
}

// A module's out-of-box records become this branch's only where the client never changed them:
// otherwise the module stops for the admin's review, before anything of it is pushed.
async function takeOver(
  deps: InstallRunDependencies,
  adoptions: readonly Adoption[],
  signal: AbortSignal,
) {
  if (adoptions.length === 0) return;
  const result = await deps.steps.takeOver(adoptions, signal);
  // A record the module may create is pushed from its source where the instance lacks it.
  const created = new Set(
    adoptions.filter((a) => a.whenAbsent === "create").map((a) => `${a.table} ${a.sysId}`),
  );
  const refused = [
    ...result.customized.map((r) => `customized on the instance: ${r}`),
    ...result.absent.filter((r) => !created.has(r)).map((r) => `not on the instance: ${r}`),
  ];
  if (refused.length > 0) {
    throw new Error(`${refused.join("; ")} (review it, then resume or drop it from the module)`);
  }
}

// Why a module's push did not arrive whole: the platform's reasons first, with their actions,
// then what is left unexplained.
function undelivered(pushed: Awaited<ReturnType<InstallRunDependencies["steps"]["push"]>>) {
  const refused = pushed.refused.map(
    (g) =>
      `the instance refused ${g.records.length} ${g.table} record(s) (${g.reason}): ${g.action}`,
  );
  const explained = pushed.refused.reduce((n, g) => n + g.records.length, 0);
  const captured = pushed.notCaptured - explained;
  const applied = pushed.notApplied - explained;
  const rest =
    captured + applied > 0
      ? [`${captured} not captured, ${applied} not applied as built: check them on the instance`]
      : [];
  return [...refused, ...rest].join("; ");
}

// Delivers modules already added (`ids`, cumulative) into the update sets named by `label`.
async function deliverAs(
  deps: InstallRunDependencies,
  ids: readonly string[],
  changes: {
    readonly pack: string;
    readonly adoptions: readonly Adoption[];
    readonly ensures: readonly EnsureFact[];
  },
  labels: { readonly label: string; readonly own: readonly string[] },
  signal: AbortSignal,
): Promise<{ outcome: "done" | "skipped"; detail: string }> {
  const { label, own } = labels;
  const added = await deps.steps.add(ids, signal);
  if (added.conflicts.length > 0) throw new Error(`merge conflicts: ${added.conflicts.join(", ")}`);
  // The generated layout files first, so their records get keys with the module's (SN-MNT-010).
  const layouts = await ensureLayouts(deps, changes.pack, changes.ensures, signal);
  await deps.steps.keys([...added.copied, ...layouts.written], signal);
  await takeOver(deps, [...changes.adoptions, ...layouts.adoptions], signal);
  const planned = await deps.steps.planPush(label, signal, own);
  if (planned.units === 0 && planned.problems.length === 0) {
    return { outcome: "skipped", detail: "the instance already holds it as built" };
  }
  if (!planned.ready) throw new Error(`plan not ready: ${planned.problems.join("; ")}`);
  const pushed = await deps.steps.push(planned.planId, label, signal);
  if (pushed.notApplied + pushed.notCaptured > 0) throw new Error(undelivered(pushed));
  return { outcome: "done", detail: deliveredDetail(pushed.units, pushed.updateSets) };
}

// The pack's earlier update sets are completed before anything is pushed, so they are promoted
// before this install's and the newest version of a record wins (ADR-0038, section 6).
async function completeEarlier(
  deps: InstallRunDependencies,
  plan: InstallPlan,
  record: { current: InstallRecord },
  signal: AbortSignal,
) {
  const name = "complete earlier update sets";
  if (plan.earlierSets.length === 0) return;
  if (record.current.steps.some((s) => s.step === name && s.outcome !== "stopped")) return;
  await step(deps, record, name, async () => {
    await deps.steps.completeUpdateSets(plan.earlierSets, signal);
    const names = plan.earlierSets.map((s) => s.name).join(", ");
    return { outcome: "done", detail: `${names}: promote them before this install's update sets` };
  });
}

// The modules the working branch already holds: re-installing them is an upgrade. Any of its
// files counts: a module that gained files since is still installed, with stale ones.
async function installedBefore(deps: InstallRunDependencies, plan: InstallPlan) {
  const present = new Set(await deps.workspace.present(plan.modules.flatMap((m) => m.files)));
  return plan.modules.filter((m) => m.files.some((f) => present.has(f)));
}

// Each new module goes into its own update set, in dependency order. Modules already in the
// workspace (a re-install or an upgrade) are refreshed and delivered first, together, under one
// upgrade update set: a module's plan builds the whole workspace, so planning them one by one
// would put one module's changes in another's update set.
async function deliver(
  deps: InstallRunDependencies,
  plan: InstallPlan,
  record: { current: InstallRecord },
  signal: AbortSignal,
) {
  // A resumed run skips the steps it finished: their update sets are done.
  const finished = new Set(
    record.current.steps.filter((s) => s.outcome !== "stopped").map((s) => s.step),
  );
  // A module this install's journal records was added by this install, not before it: a resumed
  // run keeps it in its own update set although the workspace now holds its files.
  const journaled = new Set(record.current.steps.map((s) => s.step));
  const before = (await installedBefore(deps, plan)).filter(
    (m) => !journaled.has(`module ${m.id}`),
  );
  const done = before.map((m) => m.id);
  const upgradeLabel = `${plan.pack} ${plan.version} upgrade`;
  // Every update set this install names, in this run or an earlier one.
  const own = [...plan.modules.map((m) => m.label), upgradeLabel];
  const upgrade = `modules already installed: ${done.join(", ")}`;
  if (before.length > 0 && !finished.has(upgrade)) {
    const changes = {
      pack: plan.pack,
      adoptions: before.flatMap((m) => m.adoptions),
      ensures: before.flatMap((m) => m.ensures),
    };
    await step(deps, record, upgrade, () =>
      deliverAs(deps, done, changes, { label: upgradeLabel, own }, signal),
    );
  }
  for (const module of plan.modules.filter((m) => !done.includes(m.id))) {
    done.push(module.id);
    if (finished.has(`module ${module.id}`)) continue;
    // Every module up to this one: a later add never drops an earlier module's files.
    const ids = [...done];
    const changes = { pack: plan.pack, adoptions: module.adoptions, ensures: module.ensures };
    await step(deps, record, `module ${module.id}`, () =>
      deliverAs(deps, ids, changes, { label: module.label, own }, signal),
    );
  }
}

async function load(
  deps: InstallRunDependencies,
  plan: InstallPlan,
  query: InstallQuery,
  record: { current: InstallRecord },
  signal: AbortSignal,
) {
  if (plan.data.entities.length === 0) return;
  await step(deps, record, "data", async () => {
    const domain = plan.data.domain.separated ? plan.data.domain.name : null;
    const result = await deps.steps.load(
      plan.modules.map((m) => m.id),
      query.source,
      domain,
      signal,
    );
    const count = (k: "inserted" | "updated" | "ignored") =>
      result.entities.reduce((n, e) => n + e.counts[k], 0);
    if (result.stopped) throw new Error(rowsNotTaken(result.entities));
    return {
      outcome: "done",
      detail: `${count("inserted")} inserted, ${count("updated")} updated, ${count("ignored")} unchanged`,
    };
  });
}

// Each entity's rows not taken, by reason, with what to do about them.
function rowsNotTaken(entities: readonly { entity: string; problems: readonly RowProblem[] }[]) {
  return entities
    .flatMap((e) =>
      e.problems.map(
        (p) =>
          `${e.entity}: ${p.rows.length} row(s) not taken (${p.rows.join(", ")}): ${p.reason}; ${p.action}`,
      ),
    )
    .join("; ");
}

export type { InstallRunDependencies } from "./install-step";

// Plans, and with the plan's id confirmed, runs it (ADR-0038, item 2). A run that stopped is
// resumed by the same command: its journal holds the plan id the admin approved.
export async function installPack(
  deps: InstallRunDependencies,
  query: InstallQuery & { readonly confirm?: string; readonly signal: AbortSignal },
): Promise<InstallResult> {
  const plan = await planInstall(deps, query);
  const journal = await deps.journal.read();
  const resuming = journal !== null && journal.planId === query.confirm;
  // A resumed run keeps the approved plan's folder and records the plan it resumed from.
  const folder = folderOf(plan.pack, plan.instance.name, resuming ? journal.planId : plan.planId);
  const planPath = `${folder}/${resuming ? `resume-${plan.planId}` : "plan"}.md`;
  await deps.steps.writeFile(planPath, installPlanDocument(plan));
  const base = { plan, planPath, reportPath: null, steps: [], stopped: null, commit: null };
  if (query.confirm === undefined) return base;
  if (!resuming && query.confirm !== plan.planId)
    throw new InstallPlanChangedError(query.confirm, plan.planId);
  if (!resuming && plan.problems.length > 0) throw new InstallBlockedError(plan.problems);
  if (!(await deps.journal.lock())) throw new InstallLockedError(plan.instance.name);
  try {
    const start = resuming
      ? journal
      : { planId: plan.planId, startedAt: deps.now().toISOString(), steps: [] };
    return await run(deps, plan, query, { folder, planPath }, start);
  } finally {
    await deps.journal.unlock();
  }
}

async function run(
  deps: InstallRunDependencies,
  plan: InstallPlan,
  query: InstallQuery & { readonly signal: AbortSignal },
  where: { readonly folder: string; readonly planPath: string },
  start: InstallRecord,
): Promise<InstallResult> {
  const record = { current: start };
  let stopped: InstallStepRecord | null = null;
  try {
    await components(deps, plan, record, query.signal);
    await completeEarlier(deps, plan, record, query.signal);
    await deliver(deps, plan, record, query.signal);
    await load(deps, plan, query, record, query.signal);
    await step(deps, record, "pull and integrate", async () => {
      await deps.steps.refresh(query.signal);
      return { outcome: "done", detail: "the mirror shows the installed modules" };
    });
  } catch (error) {
    if (!(error instanceof InstallStepStoppedError)) throw error;
    stopped = record.current.steps.at(-1) ?? null;
  }
  const { folder, planPath } = where;
  const reportPath = `${folder}/report.md`;
  await deps.steps.writeFile(reportPath, installReportDocument(plan, record.current, stopped));
  const commit = await deps.steps.commit(
    [planPath, reportPath],
    `snagentic accelerator install ${plan.pack} ${plan.version} on ${plan.instance.name}: ${stopped === null ? "done" : `stopped at ${stopped.step}`}`,
  );
  if (stopped === null) await deps.journal.clear();
  return { plan, planPath, reportPath, steps: record.current.steps, stopped, commit };
}
