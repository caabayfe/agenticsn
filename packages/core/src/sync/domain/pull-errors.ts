import { SnagenticError } from "../../kernel/errors";

export class PublishNeedsSharedMirrorError extends SnagenticError {
  constructor(instance: string) {
    super(
      "publish-needs-shared-mirror",
      "usage",
      `--publish pushes to the shared mirror, and ${instance}'s profile names none`,
      `add shared_mirror: { remote: origin } to instances/${instance}/instance.yaml, or pull without --publish`,
    );
  }
}

// ADR-0053: the transaction log is large and its user_agent is not indexed, so measuring a
// run's cost is itself load; it is done only when asked, and only on development instances.
export class CostNeedsDevelopmentError extends SnagenticError {
  constructor(instance: string, kind: string) {
    super(
      "cost-needs-development",
      "usage",
      `--cost reads the transaction log, which is measured only on development instances, and ${instance} is ${kind}`,
      `run without --cost: snagentic pull ${instance}`,
    );
  }
}

export class VerifyNeedsPullError extends SnagenticError {
  constructor(instance: string) {
    super(
      "verify-needs-pull",
      "usage",
      `--verify checks a completed pull, and ${instance} has none to check`,
      `run: snagentic pull ${instance}`,
    );
  }
}
