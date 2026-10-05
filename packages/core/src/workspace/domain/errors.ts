import { SnagenticError } from "../../kernel/errors";

export class WorkspaceLayoutError extends SnagenticError {
  constructor(message: string, hint: string) {
    super("workspace-layout", "precondition", message, hint);
  }
}

export class WorkspaceNotFoundError extends SnagenticError {
  constructor(start: string) {
    super(
      "workspace-not-found",
      "precondition",
      `no snagentic workspace contains ${start}`,
      "run `snagentic init <path>` to create one, or pass --workspace <path>",
    );
  }
}

export class WorkspaceExistsError extends SnagenticError {
  constructor(directory: string) {
    super(
      "workspace-exists",
      "precondition",
      `${directory} is already a snagentic workspace`,
      "use it as it is, or choose another folder",
    );
  }
}

export class NestedRepositoryError extends SnagenticError {
  constructor(directory: string) {
    super(
      "nested-repository",
      "precondition",
      `${directory} is inside another git repository`,
      "a workspace must be its own repository; choose a folder such as ~/snagentic/<name>",
    );
  }
}

export class DirectoryNotEmptyError extends SnagenticError {
  constructor(directory: string) {
    super(
      "directory-not-empty",
      "precondition",
      `${directory} already contains files`,
      "choose an empty or new folder for the workspace",
    );
  }
}
