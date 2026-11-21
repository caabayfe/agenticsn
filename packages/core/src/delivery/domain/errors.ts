import { SnagenticError } from "../../kernel/errors";

export class PushConfirmationRequiredError extends SnagenticError {
  // `abandon`: what push --abandon-pending would leave on the instance, for the user to approve.
  constructor(abandon?: readonly string[]) {
    if (abandon === undefined)
      super(
        "push-confirmation-required",
        "usage",
        "push changes the instance and needs explicit confirmation",
        "show the user the plan from plan_push; once they approve, push with confirm set to true",
      );
    else
      super(
        "push-confirmation-required",
        "usage",
        `abandoning this delivery rolls nothing back and needs explicit confirmation; what stays on the instance:\n${abandon.map((line) => `  ${line}`).join("\n")}`,
        "show the user this list; once they accept that it stays on the instance, run the same command with confirm set to true (--confirm)",
      );
  }
}

export class NoPendingDeliveryError extends SnagenticError {
  constructor(instance: string) {
    super(
      "no-pending-delivery",
      "precondition",
      `no unfinished delivery to ${instance}: there is nothing to abandon`,
      `plan as usual: snagentic plan-push --instance ${instance}`,
    );
  }
}

export class PendingDeliveryPlanError extends SnagenticError {
  constructor(given: string, stopped: string, instance: string) {
    super(
      "pending-delivery-plan",
      "precondition",
      `the unfinished delivery to ${instance} is push ${stopped}, not ${given}`,
      `snagentic status --instance ${instance} shows the unfinished push; to abandon it: snagentic push --instance ${instance} --abandon-pending --plan ${stopped}`,
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

export class PendingDeliveryTargetError extends SnagenticError {
  // `exit`: what to do when recovery refuses (authoring's ABANDON_PENDING_EXIT).
  constructor(updateName: string, instance: string, exit: string) {
    super(
      "pending-delivery-target",
      "precondition",
      `${updateName} has unfinished delivery in another update set`,
      `finish it in its original update set first: snagentic plan-push --instance ${instance} --recover-pending; if that refuses, ${exit}`,
    );
  }
}

export class RecordChangedOnInstanceError extends SnagenticError {
  // `projectsLoaded` is what the push journal holds: one step per project, not per record.
  constructor(
    unit: { readonly updateName: string; readonly table: string; readonly sysId: string },
    instance: string,
    projectsLoaded: number,
  ) {
    const loaded =
      projectsLoaded === 0
        ? "no record was loaded"
        : `nothing was loaded for its project, but ${projectsLoaded} other project(s) of this push were already loaded`;
    const record = /^[0-9a-f]{32}$/.test(unit.sysId) ? `${unit.table}:${unit.sysId}` : "<record>";
    super(
      "record-changed-on-instance",
      "precondition",
      `${unit.updateName} changed on the instance after the plan read it; ${loaded}`,
      `run snagentic plan-push again to see what changed; for a record you adopted, run snagentic pull ${instance}, then snagentic adopt --instance ${instance} --refresh ${record}, then plan and push again`,
    );
  }
}

export class UpdateSetScopeError extends SnagenticError {
  constructor(name: string, scope: string) {
    super(
      "update-set-scope",
      "precondition",
      `the instance created the update set "${name}" outside the application ${scope} and would not move it; no record was written`,
      "open the update set on the instance, set its application to the scope, then push again",
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

export class UncommittedPlannedChangesError extends SnagenticError {
  constructor(paths: readonly string[]) {
    super(
      "uncommitted-planned-changes",
      "precondition",
      `a pull request would not show what is pushed: uncommitted changes in ${paths.join(", ")}`,
      "commit the changes, then push again with draftPr (or push without it)",
    );
  }
}

export class PullRequestFromDefaultBranchError extends SnagenticError {
  constructor(branch: string) {
    super(
      "pull-request-from-default-branch",
      "precondition",
      `${branch} is the repository's default branch, so a pull request has nothing to merge into`,
      "create a branch for this change (git switch -c <name>), then push again with draftPr",
    );
  }
}

export class PullRequestUnavailableError extends SnagenticError {
  constructor(reason: string) {
    super(
      "pull-request-unavailable",
      "precondition",
      `cannot open a pull request: ${reason}`,
      "install and sign in to the GitHub CLI (gh auth login), or push without draftPr",
    );
  }
}

export class BranchNotPublishedError extends SnagenticError {
  constructor(branch: string, remote: string, reason: string) {
    super(
      "branch-not-published",
      "remote",
      `could not push ${branch} to ${remote}: ${reason}`,
      "check the remote (git remote -v) and your access to it, then push again with draftPr",
    );
  }
}
