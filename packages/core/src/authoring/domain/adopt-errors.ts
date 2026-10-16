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
