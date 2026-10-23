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

export class InstallPlanChangedError extends SnagenticError {
  constructor(confirmed: string, current: string) {
    super(
      "install-plan-changed",
      "precondition",
      `the install plan is now ${current}, not the approved ${confirmed}: the pack or the instance changed since it was planned`,
      "read the new plan (written in accelerators/installs/), get it approved, then confirm its id",
    );
  }
}

export class InstallBlockedError extends SnagenticError {
  constructor(problems: readonly string[]) {
    super(
      "install-blocked",
      "precondition",
      `the install plan has blocking problems: ${problems.join("; ")}`,
      "fix them on the instance or in the pack, then plan the install again",
    );
  }
}

export class InstallLockedError extends SnagenticError {
  constructor(instance: string) {
    super(
      "install-locked",
      "precondition",
      `another install is running on ${instance}`,
      "wait for it to finish; if none is running, remove .snagentic/<instance>/install.lock",
    );
  }
}

// A step of a running install stopped: the run records it and writes the report (ADR-0038).
// Caught by the run, never shown on its own.
export class InstallStepStoppedError extends SnagenticError {
  constructor(step: string, detail: string) {
    super(
      "install-step-stopped",
      "precondition",
      `${step}: ${detail}`,
      "fix what the step reports, then run the same command to resume",
    );
  }
}

// The data cannot go into a domain: the instance separates data by domain and --domain names
// none of its domains, or it does not and --domain was given (spec 011, section 15).
export class DataDomainError extends SnagenticError {
  constructor(problem: string) {
    super(
      "data-domain",
      "precondition",
      problem,
      "name one of the instance's domains with --domain, or leave it out where the instance has none; pull first if the mirror lists no domains file",
    );
  }
}
