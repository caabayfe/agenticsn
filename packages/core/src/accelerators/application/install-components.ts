import {
  PluginActivationFailedError,
  StoreAppInstallFailedError,
  StoreAppNotOfferedError,
} from "../../plugins/index";
import type { InstallPlan, InstallRecord, PlannedComponent } from "../domain/install-plan";
import { type RefusedComponent, skipStep, withoutRefused } from "../domain/refused-components";
import { type InstallRunDependencies, step } from "./install-step";
import { recheckFields } from "./recheck-fields";
import { resumeLost } from "./resume-components";

// The platform said no to the change, as opposed to an answer the run lost (which it follows on
// the next run) or a failure of snagentic's own.
const isRefusal = (error: unknown): error is Error =>
  error instanceof StoreAppInstallFailedError ||
  error instanceof PluginActivationFailedError ||
  error instanceof StoreAppNotOfferedError;

// Runs one component change. A licensed component the instance refuses is recorded as skipped,
// for its modules to be left out; anything else stops the run, as before (owner, 2026-11-08).
async function change(
  c: PlannedComponent,
  refused: RefusedComponent[],
  request: () => Promise<{ readonly seconds: number }>,
  doneDetail: (seconds: number) => string,
): Promise<{ outcome: "done" | "skipped"; detail: string }> {
  try {
    const { seconds } = await request();
    return { outcome: "done", detail: doneDetail(seconds) };
  } catch (error) {
    if (c.entitlement !== "licensed" || !isRefusal(error)) throw error;
    refused.push({ kind: c.kind, id: c.id, reason: error.message });
    return {
      outcome: "skipped",
      detail: `refused by the instance: ${error.message}; the modules that need it are left out`,
    };
  }
}

// Plugins the plan activates and store applications it installs, then a pull, then the fields that
// waited for them (spec 011, §15 and I3). A resumed run first reads the outcomes the earlier run
// lost, and requests nothing a journaled step already did; it asks again for a refused one.
// Returns the plan the rest of the run follows: without the modules of refused components.
export async function components(
  deps: InstallRunDependencies,
  plan: InstallPlan,
  record: { current: InstallRecord },
  signal: AbortSignal,
): Promise<InstallPlan> {
  await resumeLost(deps, record, signal);
  const done = new Set(record.current.steps.filter((s) => s.outcome === "done").map((s) => s.step));
  const refused: RefusedComponent[] = [];
  const activations = plan.components.filter((c) => c.action === "activate");
  for (const c of activations) {
    if (done.has(`activate ${c.id}`)) continue;
    await step(deps, record, `activate ${c.id}`, () =>
      change(
        c,
        refused,
        () => deps.steps.activatePlugin(c.id, signal),
        (s) => `active after ${s} s`,
      ),
    );
  }
  const installs = plan.components.filter((c) => c.action === "install");
  for (const c of installs) {
    const version = c.version ?? "";
    const demoData = c.demoData === true;
    const name = `install ${c.id} ${version}${demoData ? " with demo data" : ""}`;
    if (done.has(name)) continue;
    const request = () => deps.steps.installApp(c.id, version, demoData, signal);
    await step(deps, record, name, () =>
      change(c, refused, request, (s) => `installed after ${s} s`),
    );
  }
  if (activations.length + installs.length > 0) {
    await step(deps, record, "pull and integrate", async () => {
      await deps.steps.refresh(signal);
      return { outcome: "done", detail: "the mirror holds the new components" };
    });
  }
  const kept = withoutRefused(plan, refused);
  await recordSkipped(deps, record, kept.skipped);
  await checkFields(deps, kept.plan, record);
  return kept.plan;
}

// Each module left out, once in the journal, so the report names it with the reason.
async function recordSkipped(
  deps: InstallRunDependencies,
  record: { current: InstallRecord },
  skipped: readonly { readonly id: string; readonly reason: string }[],
) {
  for (const module of skipped) {
    const name = skipStep(module.id);
    if (record.current.steps.some((s) => s.step === name)) continue;
    await step(deps, record, name, async () => ({ outcome: "skipped", detail: module.reason }));
  }
}

// Fields that waited for an activation, checked once the mirror holds it and before anything is
// pushed. A resumed run checks again until the step is done.
async function checkFields(
  deps: InstallRunDependencies,
  plan: InstallPlan,
  record: { current: InstallRecord },
) {
  const name = "check fields";
  const steps = record.current.steps.filter((s) => s.step === name);
  if (steps.some((s) => s.outcome !== "stopped")) return;
  if (steps.length === 0 && !plan.fields.some((f) => f.state === "after-activation")) return;
  await step(deps, record, name, async () => {
    const { checked, problems, warnings } = await recheckFields(plan.fields, deps.schema);
    if (problems.length > 0) throw new Error(problems.join("; "));
    const lost = warnings.length === 0 ? "" : `; installed without: ${warnings.join("; ")}`;
    return { outcome: "done", detail: `${checked} field(s) checked after the activation${lost}` };
  });
}
