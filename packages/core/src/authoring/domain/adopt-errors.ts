import { SnagenticError } from "../../kernel/errors";

export class AdoptRecordsNotFoundError extends SnagenticError {
  constructor(records: readonly string[]) {
    super(
      "adopt-records-not-found",
      "precondition",
      `the instance holds none of these records: ${records.join(", ")}`,
      "the mirror may be stale: run snagentic pull, then find the records again",
    );
  }
}

export class AdoptStoreApplicationError extends SnagenticError {
  constructor(scope: string) {
    super(
      "adopt-store-application",
      "not-permitted",
      `records of ${scope}, an application installed from the store, cannot be adopted`,
      "customize it in its own application on the instance; snagentic 2.0 adopts custom applications and global only",
    );
  }
}

export class AdoptTransformFailedError extends SnagenticError {
  constructor(scope: string, message: string) {
    super(
      "adopt-transform-failed",
      "remote",
      `the ServiceNow SDK could not convert the records of ${scope}: ${message}`,
      "check that each record still exists (snagentic pull), then adopt again",
    );
  }
}

// The build of the adopted source would change what the instance holds, beyond the SDK's known
// losses: adopting would make the next push change things nobody wrote (ADR-0033 item 2).
export class AdoptUnexplainedDifferenceError extends SnagenticError {
  readonly differences: readonly string[];

  constructor(differences: readonly string[]) {
    super(
      "adopt-unexplained-difference",
      "findings",
      `the SDK's source for these records would not rebuild what the instance holds: ${differences.slice(0, 5).join("; ")}${differences.length > 5 ? ` and ${differences.length - 5} more` : ""}`,
      "nothing was written; report it with the record names (an SDK conversion gap)",
    );
    this.differences = differences;
  }
}

export class InvalidRecordReferenceError extends SnagenticError {
  constructor(reference: string) {
    super(
      "invalid-record-reference",
      "usage",
      `"${reference}" names no record: it holds no sys_id`,
      "name records by mirror path, table:sys_id or sys_id (snagentic find shows them)",
    );
  }
}

export class SdkUnavailableError extends SnagenticError {
  constructor(instance: string) {
    super(
      "sdk-unavailable",
      "precondition",
      `the connection to ${instance} cannot run the embedded ServiceNow SDK`,
      "run: snagentic doctor --instance to check the connection",
    );
  }
}

export class NothingAdoptedError extends SnagenticError {
  constructor(project: string) {
    super(
      "nothing-adopted",
      "precondition",
      `${project} has no committed ledger: there is nothing to refresh`,
      "adopt the records first (snagentic adopt), and commit the result",
    );
  }
}

export class LedgerUncommittedError extends SnagenticError {
  constructor(path: string) {
    super(
      "ledger-uncommitted",
      "precondition",
      `${path} has changes not yet committed`,
      "commit the last adopt or push first: a refresh merges from the last committed ledger",
    );
  }
}

// Security finding S2: the adopted source would hold a value a pull keeps out of the mirror (a
// password, a secret-named field, a redacted property value) or a class the mirror never holds.
// Names the units and fields, never the values.
export class AdoptSecretError extends SnagenticError {
  readonly findings: readonly string[];

  constructor(findings: readonly string[]) {
    super(
      "adopt-secret",
      "not-permitted",
      `adopting would put secrets in source: ${findings.join("; ")}`,
      "leave these records on the instance and adopt the rest; snagentic keeps secrets out of source as it keeps them out of the mirror",
    );
    this.findings = findings;
  }
}

// A scope name from the instance becomes the folder source/<scope>: anything but a ServiceNow
// scope name could point elsewhere in the workspace.
export class InvalidScopeNameError extends SnagenticError {
  constructor(scope: string) {
    super(
      "invalid-scope-name",
      "precondition",
      `the instance names the records' application ${JSON.stringify(scope)}, which is not a ServiceNow scope name`,
      "check the application's scope on the instance; snagentic adopts only scopes made of lowercase letters, digits, underscores and hyphens",
    );
  }
}

// A path from the instance or the SDK that would land outside its folder. Never expected:
// sourceScopeName and the SDK's own file names keep paths inside; this is the last check.
export class PathOutsideProjectError extends SnagenticError {
  constructor(path: string, folder: string) {
    super(
      "path-outside-project",
      "not-permitted",
      `refused to write ${JSON.stringify(path)}: it is outside ${folder}`,
      "nothing was written; report it, naming the records adopted and the SDK version (snagentic doctor)",
    );
  }
}
