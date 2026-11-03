import type { InstallPlan, InstallRecord } from "../domain/install-plan";
import { type InstallRunDependencies, step } from "./install-step";
import { recheckFields } from "./recheck-fields";
import { resumeLost } from "./resume-components";

// Plugins the plan activates and store applications it installs, then a pull, then the fields that
// waited for them (spec 011, §15 and I3). A resumed run first reads the outcomes the earlier run
// lost, and requests nothing a journaled step already did.
export async function components(
  deps: InstallRunDependencies,
  plan: InstallPlan,
  record: { current: InstallRecord },
  signal: AbortSignal,
) {
  await resumeLost(deps, record, signal);
  const done = new Set(record.current.steps.filter((s) => s.outcome === "done").map((s) => s.step));
  const activations = plan.components.filter((c) => c.action === "activate");
  for (const c of activations) {
    if (done.has(`activate ${c.id}`)) continue;
    await step(deps, record, `activate ${c.id}`, async () => {
      const { seconds } = await deps.steps.activatePlugin(c.id, signal);
      return { outcome: "done", detail: `active after ${seconds} s` };
    });
  }
  const installs = plan.components.filter((c) => c.action === "install");
  for (const c of installs) {
    const version = c.version ?? "";
    const demoData = c.demoData === true;
    const name = `install ${c.id} ${version}${demoData ? " with demo data" : ""}`;
    if (done.has(name)) continue;
    await step(deps, record, name, async () => {
      const { seconds } = await deps.steps.installApp(c.id, version, demoData, signal);
      return { outcome: "done", detail: `installed after ${seconds} s` };
    });
  }
  if (activations.length + installs.length > 0) {
    await step(deps, record, "pull and integrate", async () => {
      await deps.steps.refresh(signal);
      return { outcome: "done", detail: "the mirror holds the new components" };
    });
  }
  await checkFields(deps, plan, record);
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
