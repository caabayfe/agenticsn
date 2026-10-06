import { SnagenticError } from "../../kernel/errors";

export class NothingPulledYetError extends SnagenticError {
  constructor(instance: string) {
    super(
      "nothing-pulled-yet",
      "precondition",
      `${instance} has never been pulled, so there is no base to plan against`,
      `run snagentic pull --instance ${instance}, then integrate`,
    );
  }
}

export class MirrorNotIntegratedError extends SnagenticError {
  constructor(instance: string) {
    super(
      "mirror-not-integrated",
      "precondition",
      `the latest pull of ${instance} is not integrated into this branch; pushing would revert the instance's newer changes`,
      `run snagentic integrate --instance ${instance}, resolve any conflicts, then plan again`,
    );
  }
}
