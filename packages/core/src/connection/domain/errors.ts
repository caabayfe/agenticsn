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

// A developer instance asleep answers every request with its hibernation page (status 200).
export class InstanceHibernatingError extends SnagenticError {
  constructor(url: string) {
    super(
      "instance-hibernating",
      "remote",
      `${url} is hibernating`,
      "wake it: sign in at https://developer.servicenow.com and start the instance (it takes a few minutes), then run the command again",
    );
  }
}

// ADR-0053: every run has a request budget; the instance owner may lower it, and whoever runs
// the machine may raise it through the environment.
export class RequestBudgetExhaustedError extends SnagenticError {
  constructor(budget: number, variable = "SNAGENTIC_<NAME>_REQUEST_BUDGET") {
    super(
      "request-budget-exhausted",
      "remote",
      `stopped after ${budget} requests, the budget for this run`,
      `this protects the instance. Run the command again: a pull resumes where it stopped. If the run is expected to be larger, set ${variable}`,
    );
  }
}

// A request the client abandoned after its timeout, and its one retry (ADR-0053).
export class RequestTimedOutError extends SnagenticError {
  constructor(url: string) {
    super(
      "request-timed-out",
      "remote",
      `${url} did not answer in time, twice; snagentic slowed down and stopped`,
      "the instance is busy or the request is too large: run the command again later, or lower the load limits in instance.yaml",
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
  constructor(what: string, detail: string, access: "read" | "write" = "read") {
    super(
      "access-denied",
      "not-permitted",
      access === "read"
        ? `the integration user may not read ${what}: ${detail}`
        : `the instance refused ${what}: ${detail}`,
      access === "read"
        ? "grant the user read access (ACL or role) to it, or exclude it from the sync"
        : "the signed-in user lacks a role this write needs: grant it on the instance, or make the change there and adopt it",
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
