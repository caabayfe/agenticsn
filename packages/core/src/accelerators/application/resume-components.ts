import { ComponentChangeFailedError, ComponentChangeRunningError } from "../../plugins/index";
import type { InstallRecord, InstallStepRecord } from "../domain/install-plan";
import { type InstallRunDependencies, step } from "./install-step";

// Each step's latest record, for the steps whose outcome an earlier run lost.
function lost(record: InstallRecord): readonly (InstallStepRecord & { progressId: string })[] {
  const latest = new Map<string, InstallStepRecord>();
  for (const s of record.steps) latest.set(s.step, s);
  return [...latest.values()].flatMap((s) =>
    s.outcome === "stopped" && s.progressId !== undefined
      ? [{ ...s, progressId: s.progressId }]
      : [],
  );
}

// A component change whose outcome an earlier run lost is read from the instance before anything
// is requested: asking again could activate or install twice (spec 011, I3 c). Whatever the plan
// now says, since the plan was made from a mirror that has not seen the change.
export async function resumeLost(
  deps: InstallRunDependencies,
  record: { current: InstallRecord },
  signal: AbortSignal,
) {
  for (const { step: name, progressId } of lost(record.current)) {
    await step(deps, record, name, async () => {
      const p = await deps.steps.progress(progressId, signal);
      if (p.status === "successful") {
        const detail = `finished on the instance after the run lost it (progress ${progressId})`;
        return { outcome: "done", detail };
      }
      if (p.status === "pending" || p.status === "running")
        throw new ComponentChangeRunningError(name, p.status, p.percent, progressId);
      throw new ComponentChangeFailedError(name, p.status, p.error || p.message, progressId);
    });
  }
}
