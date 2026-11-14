import type { InstanceAnswer } from "../../connection/index";

// ADR-0056: what taking a new instance from nothing to a pulled, integrated workspace asks of
// the outside. Each step reads current state and skips what is already done, so running
// onboarding again continues after a failure.
export interface OnboardSteps {
  workspace(): Promise<"done" | "already">;
  profile(): Promise<"done" | "already">;
  // Signs in, or checks the stored credential; names how the instance answered.
  signIn(): Promise<InstanceAnswer>;
  // The names of the checks that failed.
  doctor(): Promise<{ readonly failed: readonly string[] }>;
  pull(): Promise<void>;
  integrate(): Promise<void>;
}

export type OnboardStep = "workspace" | "profile" | "sign-in" | "doctor" | "pull" | "integrate";

export interface OnboardResult {
  readonly steps: readonly { readonly step: OnboardStep; readonly did: "done" | "already" }[];
  // The step the run stopped at, with the answer or checks that stopped it; null when finished.
  readonly stoppedAt: OnboardStep | null;
  readonly answer: InstanceAnswer;
  readonly failedChecks: readonly string[];
}

const READY: InstanceAnswer = { outcome: "ready" };

export async function onboard(steps: OnboardSteps): Promise<OnboardResult> {
  const done: { step: OnboardStep; did: "done" | "already" }[] = [];
  const stopped = (
    stoppedAt: OnboardStep,
    answer: InstanceAnswer,
    failedChecks: readonly string[],
  ): OnboardResult => ({ steps: done, stoppedAt, answer, failedChecks });

  done.push({ step: "workspace", did: await steps.workspace() });
  done.push({ step: "profile", did: await steps.profile() });

  const answer = await steps.signIn();
  if (answer.outcome !== "ready") {
    return stopped("sign-in", answer, []);
  }
  done.push({ step: "sign-in", did: "done" });

  const { failed } = await steps.doctor();
  if (failed.length > 0) {
    return stopped("doctor", READY, failed);
  }
  done.push({ step: "doctor", did: "done" });

  await steps.pull();
  done.push({ step: "pull", did: "done" });
  await steps.integrate();
  done.push({ step: "integrate", did: "done" });
  return { steps: done, stoppedAt: null, answer: READY, failedChecks: [] };
}
