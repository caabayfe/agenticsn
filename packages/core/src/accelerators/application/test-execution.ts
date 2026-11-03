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
    const { changed, missing } = await deps.steps.developmentSettings(TEST_EXECUTION, signal);
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
