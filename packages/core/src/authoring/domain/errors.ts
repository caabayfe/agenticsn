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
