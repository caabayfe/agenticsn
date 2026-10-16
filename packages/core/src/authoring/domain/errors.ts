import { SnagenticError } from "../../kernel/errors";

// The SDK built a file snagentic cannot read as a unit: a format the embedded SDK version was
// not expected to write.
export class UnreadableBuildError extends SnagenticError {
  constructor(file: string, reason: string) {
    super(
      "unreadable-build",
      "precondition",
      `the Fluent build wrote ${file}, which snagentic cannot read: ${reason}`,
      "report it with the file attached; run: snagentic doctor to check the embedded SDK",
    );
  }
}

// The SDK asked for a route outside its read allow-list (ADR-0032 item 3): an SDK upgrade that
// reads differently, or a command that would write. Nothing was sent.
export class SdkRouteRefusedError extends SnagenticError {
  constructor(method: string, path: string) {
    super(
      "sdk-route-refused",
      "not-permitted",
      `the ServiceNow SDK asked for ${method} ${path}, which is not a read snagentic allows`,
      "nothing was sent; report it, naming the SDK version (snagentic doctor)",
    );
  }
}
