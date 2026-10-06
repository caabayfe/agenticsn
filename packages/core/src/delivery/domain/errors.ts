import { SnagenticError } from "../../kernel/errors";

export class NothingPulledYetError extends SnagenticError {
  constructor(instance: string) {
    super(
      "nothing-pulled-yet",
      "precondition",
      `${instance} has never been pulled, so there is no base to plan against`,
      `run snagentic pull --instance ${instance}, then integrate`,
    );
  }
}

export class MirrorNotIntegratedError extends SnagenticError {
  constructor(instance: string) {
    super(
      "mirror-not-integrated",
      "precondition",
      `the latest pull of ${instance} is not integrated into this branch; pushing would revert the instance's newer changes`,
      `run snagentic integrate --instance ${instance}, resolve any conflicts, then plan again`,
    );
  }
}

export class PushConfirmationRequiredError extends SnagenticError {
  constructor() {
    super(
      "push-confirmation-required",
      "usage",
      "push changes the instance and needs explicit confirmation",
      "show the user the plan from plan_push; once they approve, push with confirm set to true",
    );
  }
}

export class PlanChangedError extends SnagenticError {
  constructor(expected: string, actual: string) {
    super(
      "plan-changed",
      "precondition",
      `the plan changed since it was reviewed (${expected} is now ${actual})`,
      "run plan_push again and review the new plan before pushing",
    );
  }
}

export class PlanNotReadyError extends SnagenticError {
  constructor() {
    super(
      "plan-not-ready",
      "precondition",
      "the plan has problems, a failing gate or collisions",
      "run plan_push to see what blocks it, fix that, then plan again",
    );
  }
}

export class RecordChangedOnInstanceError extends SnagenticError {
  constructor(path: string, written: number) {
    super(
      "record-changed-on-instance",
      "precondition",
      `${path} changed on the instance since the last pull; nothing was written for it (${written} record(s) already written)`,
      "run pull and integrate, check the merged record, then plan and push again",
    );
  }
}

export class UnfinishedPushError extends SnagenticError {
  constructor(planId: string) {
    super(
      "unfinished-push",
      "precondition",
      `push ${planId} did not finish; the instance may hold some of its writes`,
      "run pull and integrate so the mirror shows what was written, then plan and push again",
    );
  }
}

export class IntegrationUserNotFoundError extends SnagenticError {
  constructor(username: string) {
    super(
      "integration-user-not-found",
      "remote",
      `no user ${username} on the instance, so its current update set cannot be set`,
      "check the instance profile's username, or run doctor --instance",
    );
  }
}
