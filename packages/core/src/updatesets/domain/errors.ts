import { SnagenticError } from "../../kernel/errors";

export class UpdateSetNotFoundError extends SnagenticError {
  constructor(instance: string, sysId: string) {
    super(
      "update-set-not-found",
      "precondition",
      `${instance} has no update set ${sysId} that this user can read`,
      `list them with: snagentic update-sets list ${instance}`,
    );
  }
}
