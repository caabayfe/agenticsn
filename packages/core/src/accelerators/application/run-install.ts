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

// A module's out-of-box layouts become this branch's only where the client never changed them:
// otherwise the module stops for the admin's review, before anything of it is pushed.
async function takeOver(
  deps: InstallRunDependencies,
  adoptions: readonly Adoption[],
  signal: AbortSignal,
) {
  if (adoptions.length === 0) return;
  const result = await deps.steps.takeOver(adoptions, signal);
  const refused = [
    ...result.customized.map((r) => `customized on the instance: ${r}`),
    ...result.absent.map((r) => `not on the instance: ${r}`),
  ];
  if (refused.length > 0) {
    throw new Error(`${refused.join("; ")} (review it, then resume or drop it from the module)`);
  }
}

async function deliver(
  deps: InstallRunDependencies,
  plan: InstallPlan,
  record: { current: InstallRecord },
  signal: AbortSignal,
) {
  const ids = plan.modules.map((m) => m.id);
  // A resumed run skips the modules it finished: their update sets are done, and planning
  // one again would take in the later modules' files the workspace already holds.
  const finished = new Set(
    record.current.steps.filter((s) => s.outcome !== "stopped").map((s) => s.step),
  );
  for (const [index, module] of plan.modules.entries()) {
    if (finished.has(`module ${module.id}`)) continue;
    await step(deps, record, `module ${module.id}`, async () => {
      // Every module up to this one: a later add never drops an earlier module's files.
      const added = await deps.steps.add(ids.slice(0, index + 1), signal);
      if (added.conflicts.length > 0)
        throw new Error(`merge conflicts: ${added.conflicts.join(", ")}`);
      await deps.steps.keys(added.copied, signal);
      await takeOver(deps, module.adoptions, signal);
      const planned = await deps.steps.planPush(module.label, signal);
      if (planned.units === 0 && planned.problems.length === 0) {
        return { outcome: "skipped", detail: "the instance already holds it as built" };
      }
      if (!planned.ready) throw new Error(`plan not ready: ${planned.problems.join("; ")}`);
      const pushed = await deps.steps.push(planned.planId, module.label, signal);
      if (pushed.notApplied + pushed.notCaptured > 0) {
        throw new Error(
          `${pushed.notCaptured} not captured, ${pushed.notApplied} not applied as built: check them on the instance`,
        );
      }
      return {
        outcome: "done",
        detail: `${pushed.units} unit(s) into ${pushed.updateSets.join(", ")}`,
      };
    });
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
