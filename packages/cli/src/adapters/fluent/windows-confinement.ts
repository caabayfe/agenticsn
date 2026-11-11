import { SnagenticError } from "@snagentic/core";
import { z } from "zod";

// ADR-0055, step 1: on Windows the SDK worker runs at low integrity inside a job. Windows' no-write-up
// rule then stops it writing anywhere labelled medium (the workspace, other projects, the user's
// profile) except the folders snagentic labels low for it: its build copy and its scratch folder.
// The job allows no other process. The network stays open (step 2, AppContainer, would close it).
//
// The worker confines itself, before it reads anything of the project: Bun.spawn can't start a
// process with another token, and a launcher would need its own channel to the worker.

// snagentic sets it, holding the folders as JSON, to ask the worker to confine itself.
export const LOW_INTEGRITY_FOLDERS = "SNAGENTIC_WORKER_LOW_INTEGRITY_FOLDERS";

export interface Win32Confinement {
  readonly labelLowIntegrity: (folder: string) => void;
  readonly joinJobWithoutChildren: () => void;
  readonly lowerToLowIntegrity: () => void;
}

export class WorkerConfinementError extends SnagenticError {
  constructor(detail: string) {
    super(
      "worker-confinement-failed",
      "precondition",
      `the Fluent build worker could not confine itself: ${detail}`,
      "snagentic runs the worker without the sandbox, still with no credential; run snagentic doctor",
    );
  }
}

const Folders = z.array(z.string().min(1)).min(1);

function folders(value: string): readonly string[] {
  try {
    return Folders.parse(JSON.parse(value));
  } catch {
    throw new WorkerConfinementError(`unreadable ${LOW_INTEGRITY_FOLDERS}`);
  }
}

// Confines the worker when snagentic asked for it; the order matters: labelling needs the
// worker's medium integrity, and the job is joined before the token can no longer open it.
export function confineWorker(
  env: Readonly<Record<string, string | undefined>>,
  load: () => Win32Confinement,
): "low-integrity" | "none" {
  const asked = env[LOW_INTEGRITY_FOLDERS];
  if (asked === undefined) return "none";
  const writable = folders(asked);
  try {
    const calls = load();
    for (const folder of writable) calls.labelLowIntegrity(folder);
    calls.joinJobWithoutChildren();
    calls.lowerToLowIntegrity();
  } catch (error) {
    throw new WorkerConfinementError(error instanceof Error ? error.message : String(error));
  }
  return "low-integrity";
}
