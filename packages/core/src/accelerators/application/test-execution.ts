import { type InstallPlan, type InstallRecord, TEST_EXECUTION } from "../domain/install-plan";
import { type InstallRunDependencies, step } from "./install-step";

// The packs' ATF tests run only once test execution is on: every install on a development
// instance turns it on where it is off, in an update set that is never promoted (ADR-0047).
export async function turnOnTests(
  deps: InstallRunDependencies,
  plan: InstallPlan,
  record: { current: InstallRecord },
  signal: AbortSignal,
) {
  const name = "turn on ATF test execution";
  if (plan.instance.kind !== "development") return;
  if (record.current.steps.some((s) => s.step === name && s.outcome !== "stopped")) return;
  await step(deps, record, name, async () => {
    const { changed, missing } = await deps.steps.developmentSettings(
      TEST_EXECUTION,
      signal,
      "tests",
    );
    const lacks = missing.length === 0 ? "" : `; the instance lacks ${missing.join(", ")}`;
    return {
      outcome: "done",
      detail:
        changed.length === 0
          ? `already on${lacks}`
          : `turned on ${changed.join(", ")}, in an update set set to ignore${lacks}`,
    };
  });
}

// The demo modules' loaders refuse until their properties are on: --demo turns them on once the
// modules are delivered, as their own update sets ship them off (ADR-0049).
export async function turnOnDemoModules(
  deps: InstallRunDependencies,
  plan: InstallPlan,
  record: { current: InstallRecord },
  signal: AbortSignal,
) {
  const name = "turn on the demo modules";
  if (plan.instance.kind !== "development" || Object.keys(plan.demoSettings).length === 0) return;
  await step(deps, record, name, async () => {
    const { changed, missing } = await deps.steps.developmentSettings(
      plan.demoSettings,
      signal,
      "demo",
    );
    if (missing.length > 0) throw new Error(`the instance lacks ${missing.join(", ")}`);
    return {
      outcome: "done",
      detail:
        changed.length === 0
          ? "already on"
          : `set ${changed.join(", ")}, in an update set set to ignore`,
    };
  });
}

// The demo modules' loaders run as on-demand jobs: --demo runs each once, after the modules are
// on and the pack's data is loaded (ADR-0050). Each run writes demo records, so a resumed install
// that already ran them does not run them again.
export async function runDemoJobs(
  deps: InstallRunDependencies,
  plan: InstallPlan,
  record: { current: InstallRecord },
  signal: AbortSignal,
) {
  const name = "run the demo load jobs";
  if (plan.instance.kind !== "development" || plan.demoJobs.length === 0) return;
  if (record.current.steps.some((s) => s.step === name && s.outcome === "done")) return;
  await step(deps, record, name, async () => {
    const { queued, missing } = await deps.steps.demoJobs(plan.demoJobs, signal);
    if (missing.length > 0) throw new Error(`the instance lacks the jobs ${missing.join(", ")}`);
    return {
      outcome: "done",
      detail: `queued ${queued.join(", ")}: they run in the background, in the instance's system log`,
    };
  });
}
