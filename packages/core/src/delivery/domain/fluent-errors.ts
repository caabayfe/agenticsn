import { SnagenticError } from "../../kernel/errors";

// activate_flows refused one or more records: they stay inactive drafts on the instance.
export class FlowPublishFailedError extends SnagenticError {
  constructor(failures: readonly { readonly name: string; readonly message: string }[]) {
    super(
      "flow-publish-failed",
      "remote",
      `the instance did not publish ${failures.map((f) => `${f.name} (${f.message})`).join("; ")}`,
      "these flows are loaded as inactive drafts: fix the cause, then plan and push again; the next plan records what reached the instance",
    );
  }
}
