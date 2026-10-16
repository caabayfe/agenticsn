import { SnagenticError } from "../../kernel/errors";

export class NothingPulledYetError extends SnagenticError {
  constructor(instance: string) {
    super(
      "nothing-pulled-yet",
      "precondition",
      `${instance} has never been pulled, so there is no base to plan against`,
      `run snagentic pull ${instance}, then snagentic integrate ${instance}`,
    );
  }
}

export class MirrorNotIntegratedError extends SnagenticError {
  constructor(instance: string) {
    super(
      "mirror-not-integrated",
      "precondition",
      `the latest pull of ${instance} is not integrated into this branch; pushing would revert the instance's newer changes`,
      `run snagentic integrate ${instance}, resolve any conflicts, then plan again`,
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

export class ElevationUnavailableError extends SnagenticError {
  constructor() {
    super(
      "elevation-unavailable",
      "precondition",
      "the plan writes ACLs, but no elevated session can be opened for this instance",
      "a person opts the instance in with snagentic auth login <instance> --allow-elevation (ADR-0024), then plan again",
    );
  }
}

export class ElevatedUserMismatchError extends SnagenticError {
  constructor(expected: string, actual: string) {
    super(
      "elevated-user-mismatch",
      "not-permitted",
      `the elevated session signed in as ${actual}, but the profile names ${expected}; nothing was written`,
      "check the instance's login (SSO may sign in someone else), then push again",
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

export class FluentLoadUnavailableError extends SnagenticError {
  constructor(path: string) {
    super(
      "fluent-load-unavailable",
      "precondition",
      `${path}: this is delivered through the instance's Fluent load endpoint, which this connection cannot reach`,
      "push from the snagentic CLI or MCP server, which load layouts and unrecorded records (ADR-0030)",
    );
  }
}
