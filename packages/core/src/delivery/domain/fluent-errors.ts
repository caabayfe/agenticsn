import { SnagenticError } from "../../kernel/errors";

// The platform refuses to publish a flow its publishing user's domain cannot see (spike S11);
// push checks before any write instead (ADR-0028 as amended, item 7).
export class FlowDomainMismatchError extends SnagenticError {
  constructor(user: string, userDomain: string, flows: readonly string[]) {
    super(
      "flow-domain-mismatch",
      "precondition",
      `${user} is in domain ${userDomain || "global"}, but these flows are in another domain: ${flows.join(", ")}; the instance would refuse to publish them`,
      "push as a user in the flows' domain, or move the flows to the user's domain; nothing was written",
    );
  }
}

// activate_flows refused one or more records: they stay inactive drafts on the instance.
export class FlowPublishFailedError extends SnagenticError {
  constructor(failures: readonly { readonly name: string; readonly message: string }[]) {
    super(
      "flow-publish-failed",
      "remote",
      `the instance did not publish ${failures.map((f) => `${f.name} (${f.message})`).join("; ")}`,
      "these flows are loaded as inactive drafts: fix the cause, then plan and push again; run snagentic pull first if the push left its journal",
    );
  }
}
