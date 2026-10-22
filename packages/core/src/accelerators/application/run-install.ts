import { deliveredDetail } from "../domain/earlier-sets";
import { InstallBlockedError, InstallLockedError, InstallPlanChangedError } from "../domain/errors";
import { installPlanDocument, installReportDocument } from "../domain/install-document";
import type { InstallPlan, InstallRecord, InstallStepRecord } from "../domain/install-plan";
import type { Adoption } from "../domain/materialize";
import type { InstallJournal, InstallSteps } from "../ports";
import { type InstallPlanDependencies, type InstallQuery, planInstall } from "./plan-install";

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

export interface InstallRunDependencies extends InstallPlanDependencies {
  readonly steps: InstallSteps;
  readonly journal: InstallJournal;
  readonly now: () => Date;
}

// Thrown by a step to stop the run where it is, with the reason the report gives.
class Stop extends Error {}

const folderOf = (pack: string, instance: string, planId: string) =>
  `accelerators/installs/${instance}/${pack}-${planId}`;

// Runs one step, timed, recorded in the journal as it finishes.
async function step(
  deps: InstallRunDependencies,
  record: { current: InstallRecord },
  name: string,
  run: () => Promise<{ outcome: "done" | "skipped"; detail: string }>,
): Promise<void> {
  const started = deps.now().getTime();
  const seconds = () => Math.round((deps.now().getTime() - started) / 100) / 10;
  try {
    const { outcome, detail } = await run();
    record.current = {
      ...record.current,
      steps: [...record.current.steps, { step: name, outcome, detail, seconds: seconds() }],
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    record.current = {
      ...record.current,
      steps: [
        ...record.current.steps,
        { step: name, outcome: "stopped", detail, seconds: seconds() },
      ],
    };
    throw new Stop(detail);
  } finally {
    await deps.journal.write(record.current);
  }
}

async function components(
  deps: InstallRunDependencies,
  plan: InstallPlan,
  record: { current: InstallRecord },
  signal: AbortSignal,
) {
  const activations = plan.components.filter((c) => c.action === "activate");
  for (const c of activations) {
    await step(deps, record, `activate ${c.id}`, async () => {
      const { seconds } = await deps.steps.activatePlugin(c.id, signal);
      return { outcome: "done", detail: `active after ${seconds} s` };
    });
  }
  if (activations.length > 0) {
    await step(deps, record, "pull and integrate", async () => {
      await deps.steps.refresh(signal);
      return { outcome: "done", detail: "the mirror holds the new components" };
    });
  }
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

// Delivers modules already added (`ids`, cumulative) into the update sets named by `label`.
async function deliverAs(
  deps: InstallRunDependencies,
  ids: readonly string[],
  adoptions: readonly Adoption[],
  labels: { readonly label: string; readonly own: readonly string[] },
  signal: AbortSignal,
): Promise<{ outcome: "done" | "skipped"; detail: string }> {
  const { label, own } = labels;
  const added = await deps.steps.add(ids, signal);
  if (added.conflicts.length > 0) throw new Error(`merge conflicts: ${added.conflicts.join(", ")}`);
  await deps.steps.keys(added.copied, signal);
  await takeOver(deps, adoptions, signal);
  const planned = await deps.steps.planPush(label, signal, own);
  if (planned.units === 0 && planned.problems.length === 0) {
    return { outcome: "skipped", detail: "the instance already holds it as built" };
  }
  if (!planned.ready) throw new Error(`plan not ready: ${planned.problems.join("; ")}`);
  const pushed = await deps.steps.push(planned.planId, label, signal);
  if (pushed.notApplied + pushed.notCaptured > 0) {
    throw new Error(
      `${pushed.notCaptured} not captured, ${pushed.notApplied} not applied as built: check them on the instance`,
    );
  }
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
    const adoptions = before.flatMap((m) => m.adoptions);
    await step(deps, record, upgrade, () =>
      deliverAs(deps, done, adoptions, { label: upgradeLabel, own }, signal),
    );
  }
  for (const module of plan.modules.filter((m) => !done.includes(m.id))) {
    done.push(module.id);
    if (finished.has(`module ${module.id}`)) continue;
    // Every module up to this one: a later add never drops an earlier module's files.
    const ids = [...done];
    await step(deps, record, `module ${module.id}`, () =>
      deliverAs(deps, ids, module.adoptions, { label: module.label, own }, signal),
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
    const result = await deps.steps.load(
      plan.modules.map((m) => m.id),
      query.source,
      signal,
    );
    const count = (k: "inserted" | "updated" | "ignored") =>
      result.entities.reduce((n, e) => n + e.counts[k], 0);
    const failed = result.entities.flatMap((e) => e.failed.map((f) => `${e.entity} ${f}`));
    if (result.stopped) throw new Error(`rows not taken: ${failed.join(", ")}`);
    return {
      outcome: "done",
      detail: `${count("inserted")} inserted, ${count("updated")} updated, ${count("ignored")} unchanged`,
    };
  });
}

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
    if (!(error instanceof Stop)) throw error;
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
