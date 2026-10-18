import { SnagenticError } from "../../kernel/errors";

export class PackNotFoundError extends SnagenticError {
  constructor(pack: string, known: readonly string[]) {
    super(
      "pack-not-found",
      "usage",
      `no accelerator pack ${pack}`,
      known.length === 0
        ? "this snagentic ships no accelerator packs"
        : `run snagentic accelerator list; known packs: ${known.join(", ")}`,
    );
  }
}

export class InvalidPackError extends SnagenticError {
  constructor(pack: string, problems: readonly string[]) {
    super(
      "invalid-pack",
      "precondition",
      `accelerator pack ${pack} is not valid: ${problems.join("; ")}`,
      "fix the pack where it lives (its pack path, or report it if snagentic ships it), then run the command again",
    );
  }
}

export class PackNotAddableError extends SnagenticError {
  constructor(pack: string, problems: readonly string[]) {
    super(
      "pack-not-addable",
      "precondition",
      `cannot add ${pack}: ${problems.join("; ")}`,
      `run snagentic accelerator check ${pack} with your instance, do what it says, then add again`,
    );
  }
}

export class TrackedDataError extends SnagenticError {
  constructor(directory: string) {
    super(
      "tracked-data",
      "precondition",
      `${directory} is tracked by git: customer data must never be committed (ASR-08)`,
      "move the data files outside the workspace, or under a path .gitignore excludes, and remove them from git",
    );
  }
}

export class TemplatesInvalidError extends SnagenticError {
  constructor(pack: string, problems: number) {
    super(
      "templates-invalid",
      "findings",
      `${problems} problem(s) in ${pack}'s data templates: nothing was loaded`,
      `run snagentic accelerator validate-data ${pack} with the same --data <dir> or --demo to see them, fix the templates, then load again`,
    );
  }
}

export class LoadConfirmationRequiredError extends SnagenticError {
  constructor() {
    super(
      "load-confirmation-required",
      "usage",
      "accelerator load writes records to the instance and needs explicit confirmation",
      "check the templates with accelerator validate-data, then load with --confirm",
    );
  }
}

export class DataSourceRequiredError extends SnagenticError {
  constructor() {
    super(
      "data-source-required",
      "usage",
      "name the data to use: a directory of templates, or the pack's demo data",
      "pass --data <directory> (customer data, outside git) or --demo (the pack's fictional data), not both",
    );
  }
}
