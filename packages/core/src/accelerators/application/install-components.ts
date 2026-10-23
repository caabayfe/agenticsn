import type { InstallPlan, InstallRecord } from "../domain/install-plan";
import { type InstallRunDependencies, step } from "./install-step";
import { recheckFields } from "./recheck-fields";

// Plugins the plan activates, then a pull, then the fields that waited for them (spec 011, §15).
export async function components(
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
