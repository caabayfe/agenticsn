import { SnagenticError } from "../../kernel/errors";

export class InstanceUnreachableError extends SnagenticError {
  constructor(url: string, reason: string) {
    super(
      "instance-unreachable",
      "remote",
      `could not reach ${url}: ${reason}`,
      "check the URL and your network; developer instances hibernate when idle (wake it in the developer portal)",
    );
  }
}

export class RequestBudgetExhaustedError extends SnagenticError {
  constructor(budget: number) {
    super(
      "request-budget-exhausted",
      "remote",
      `stopped after ${budget} requests, the budget for this run`,
      "this protects the instance; raise the budget only if the run is expected to be larger",
    );
  }
}

export class AuthenticationFailedError extends SnagenticError {
  constructor(instance: string) {
    super(
      "authentication-failed",
      "precondition",
      `the instance rejected the stored credentials for "${instance}"`,
      `run: snagentic auth login ${instance}`,
    );
  }
}

export class AccessDeniedError extends SnagenticError {
  constructor(what: string, detail: string) {
    super(
      "access-denied",
      "not-permitted",
      `the integration user may not read ${what}: ${detail}`,
      "grant the user read access (ACL or role) to it, or exclude it from the sync",
    );
  }
}

export class InstanceError extends SnagenticError {
  constructor(message: string) {
    super(
      "instance-error",
      "remote",
      message,
      "retry later; if it persists, check the instance's system logs",
    );
  }
}
