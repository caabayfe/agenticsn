import { InstallStepStoppedError } from "../domain/errors";
import type { InstallRecord } from "../domain/install-plan";
import type { InstallJournal, InstallSteps } from "../ports";
import type { InstallPlanDependencies } from "./plan-install";

export interface InstallRunDependencies extends InstallPlanDependencies {
  readonly steps: InstallSteps;
  readonly journal: InstallJournal;
  readonly now: () => Date;
}

// Runs one step, timed, recorded in the journal as it finishes.
export async function step(
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
    // Stops the run where it is, with the reason the report gives.
    throw new InstallStepStoppedError(name, detail);
  } finally {
    await deps.journal.write(record.current);
  }
}
