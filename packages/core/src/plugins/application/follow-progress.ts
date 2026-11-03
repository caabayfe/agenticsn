import { SnagenticError } from "../../kernel/errors";
import type { ActivationProgress } from "../ports";

// Starting and following a CI/CD request: a plugin activation or a store application install.
// Both change the instance and are never retried, so every ambiguity ends as "unknown".

export interface FollowDependencies {
  readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly now: () => Date;
}

export interface ActivationLimits {
  readonly pollMs: number;
  readonly maxWaitMs: number;
}

export const DEFAULT_LIMITS: ActivationLimits = { pollMs: 5_000, maxWaitMs: 45 * 60_000 };

// The error that says the outcome is unknown, with the progress to check when there is one.
export type UnknownOutcome = (reason: string, progressId: string | null) => SnagenticError;

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// A refusal the instance stated (rights, unknown id) is a definite answer; anything else after
// the request was sent leaves the outcome unknown.
export async function startOnce(
  request: () => Promise<ActivationProgress>,
  unknown: UnknownOutcome,
): Promise<ActivationProgress> {
  try {
    return await request();
  } catch (error) {
    if (
      error instanceof SnagenticError &&
      (error.category === "not-permitted" || error.category === "usage")
    ) {
      throw error;
    }
    throw unknown(reasonOf(error), null);
  }
}

// Follows a started request to its end, within the time limit.
export async function follow(
  deps: FollowDependencies,
  first: ActivationProgress,
  read: (progressId: string) => Promise<ActivationProgress>,
  run: {
    readonly limits: ActivationLimits;
    readonly signal: AbortSignal;
    readonly report: (progress: ActivationProgress) => void;
    readonly unknown: UnknownOutcome;
  },
): Promise<ActivationProgress> {
  const started = deps.now().getTime();
  let current = first;
  while (current.status === "pending" || current.status === "running") {
    run.report(current);
    if (deps.now().getTime() - started >= run.limits.maxWaitMs) {
      const minutes = Math.round(run.limits.maxWaitMs / 60_000);
      throw run.unknown(`still ${current.status} after ${minutes} min`, current.progressId);
    }
    await deps.sleep(run.limits.pollMs, run.signal);
    try {
      current = await read(current.progressId);
    } catch (error) {
      throw run.unknown(`its progress could not be read: ${reasonOf(error)}`, current.progressId);
    }
  }
  return current;
}
