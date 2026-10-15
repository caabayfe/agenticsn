import { SnagenticError } from "../../kernel/errors";

export class UnknownBaseError extends SnagenticError {
  constructor(base: string) {
    super(
      "unknown-base",
      "usage",
      `nothing to compare with: ${JSON.stringify(base)} is not a commit, branch or tag`,
      "pass a ref that exists in the workspace, for example HEAD or origin/main",
    );
  }
}

export class FluentKeysUnstagedError extends SnagenticError {
  constructor(path: string) {
    super(
      "fluent-keys-unstaged",
      "usage",
      `${path} has changes that are not staged: snagentic will not overwrite them`,
      "stage keys.ts (git add) or discard its changes, then commit again",
    );
  }
}
