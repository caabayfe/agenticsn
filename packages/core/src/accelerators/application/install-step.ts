import { InstallStepStoppedError } from "../domain/errors";
import type { InstallRecord, InstallStepRecord } from "../domain/install-plan";
import type { InstallJournal, InstallSteps } from "../ports";
import type { InstallPlanDependencies } from "./plan-install";

// Where a module step stands among the plan's modules: the modules already installed are
// delivered together, as one step covering several places.
export interface InstallPlace {
  readonly first: number;
  readonly last: number;
  readonly total: number;
}

// What an install says as it runs, so the admin sees what it does and how much is left.
export type InstallProgress =
  | {
      readonly kind: "begin";
      readonly planId: string;
      readonly title: string;
      readonly modules: number;
      // Modules an earlier run of the same plan finished: a resumed run skips them.
      readonly finished: number;
    }
  | { readonly kind: "start"; readonly step: string; readonly place: InstallPlace | null }
  | ({ readonly kind: "end"; readonly place: InstallPlace | null } & InstallStepRecord);

export interface InstallRunDependencies extends InstallPlanDependencies {
  readonly steps: InstallSteps;
  readonly journal: InstallJournal;
  readonly now: () => Date;
  readonly progress?: (event: InstallProgress) => void;
}

// Runs one step, timed, recorded in the journal as it finishes.
export async function step(
  deps: InstallRunDependencies,
  record: { current: InstallRecord },
  name: string,
  run: () => Promise<{ outcome: "done" | "skipped"; detail: string }>,
  place: InstallPlace | null = null,
): Promise<void> {
  const started = deps.now().getTime();
  const seconds = () => Math.round((deps.now().getTime() - started) / 100) / 10;
  const finish = (finished: InstallStepRecord) => {
    record.current = { ...record.current, steps: [...record.current.steps, finished] };
    deps.progress?.({ kind: "end", place, ...finished });
  };
  deps.progress?.({ kind: "start", step: name, place });
  try {
    const { outcome, detail } = await run();
    finish({ step: name, outcome, detail, seconds: seconds() });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    finish({ step: name, outcome: "stopped", detail, seconds: seconds() });
    // Stops the run where it is, with the reason the report gives.
    throw new InstallStepStoppedError(name, detail);
  } finally {
    await deps.journal.write(record.current);
  }
}
