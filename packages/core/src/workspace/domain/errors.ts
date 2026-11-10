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

// Another snagentic command is changing the instance's mirror or the instance itself, or, with
// instance null, the workspace's files outside any instance.
export class WorkspaceLockedError extends SnagenticError {
  constructor(
    instance: string | null,
    holder: {
      readonly command: string;
      readonly pid: number;
      readonly host: string;
      readonly started: string;
    } | null,
  ) {
    const who =
      holder === null
        ? "another snagentic command"
        : `\`${holder.command}\` (pid ${holder.pid} on ${holder.host}, started ${holder.started})`;
    const what = instance === null ? "this workspace" : `${instance} in this workspace`;
    const file =
      instance === null ? ".snagentic/workspace.lock" : `.snagentic/${instance}/workspace.lock`;
    super(
      "workspace-locked",
      "precondition",
      `${who} is changing ${what}`,
      `wait for it to finish, then run the command again; if it is no longer running, remove ${file}`,
    );
  }
}
