import { SnagenticError } from "../../kernel/errors";

// ADR-0052 item 7: a watermark later than the instance's clock would hide every change made
// before it.
export class FutureWatermarkError extends SnagenticError {
  constructor(instance: string, watermark: string) {
    super(
      "watermark-in-future",
      "precondition",
      `the mirror's pull state says ${instance} was pulled up to ${watermark} UTC, later than the instance's own clock`,
      `the state was not written by a pull: run snagentic pull ${instance} --full, and check who can push servicenow-remote/${instance}`,
    );
  }
}

// ADR-0052 item 5: only the user the shared state names publishes, so one user's read access
// shapes the shared mirror.
export class PublishRefusedError extends SnagenticError {
  constructor(instance: string, user: string, owner: string) {
    super(
      "publish-refused",
      "not-permitted",
      `the shared mirror of ${instance} was pulled by ${owner}; ${user} may pull it but not publish it`,
      "publish with the designated puller's account (the scheduled CI pull), or pull without --publish",
    );
  }
}

export class PublishRejectedError extends SnagenticError {
  constructor(instance: string, remote: string) {
    super(
      "publish-rejected",
      "remote",
      `${remote} refused servicenow-remote/${instance} twice: another pull published in between`,
      `run: snagentic pull ${instance} --publish again; only fast-forward pushes are made`,
    );
  }
}

export class SharedMirrorUnreachableError extends SnagenticError {
  constructor(remote: string, reason: string) {
    super(
      "shared-mirror-unreachable",
      "remote",
      `git could not reach the shared mirror on ${remote}: ${reason}`,
      `check that git fetch ${remote} works with your git credentials, then run the command again`,
    );
  }
}
