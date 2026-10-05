import { SnagenticError } from "../../kernel/errors";

export class InvalidInstanceUrlError extends SnagenticError {
  constructor(value: string, reason: string) {
    super(
      "invalid-instance-url",
      "usage",
      `invalid instance URL ${JSON.stringify(value)}: ${reason}`,
      "use the instance name (dev12345) or its https address (https://dev12345.service-now.com)",
    );
  }
}

export class ReadOnlyAcknowledgementRequiredError extends SnagenticError {
  constructor(kind: string) {
    super(
      "read-only-acknowledgement-required",
      "not-permitted",
      `adding a ${kind} instance requires acknowledging that its credential must be read-only`,
      "use an integration user with read-only roles, then add --acknowledge-read-only",
    );
  }
}

export class InstanceExistsError extends SnagenticError {
  constructor(name: string) {
    super(
      "instance-exists",
      "precondition",
      `instance "${name}" already exists`,
      "choose another name, or remove it first",
    );
  }
}

export class InstanceUrlExistsError extends SnagenticError {
  constructor(url: string, existing: string) {
    super(
      "instance-url-exists",
      "precondition",
      `${url} is already configured as "${existing}"`,
      `use "${existing}"; one instance must have one name, so syncs and locks never overlap`,
    );
  }
}

export class InstanceNotFoundError extends SnagenticError {
  constructor(name: string) {
    super(
      "instance-not-found",
      "precondition",
      `no instance named "${name}" in this workspace`,
      "run: snagentic instance list",
    );
  }
}

export class CredentialsMissingError extends SnagenticError {
  constructor(name: string, variable: string) {
    super(
      "credentials-missing",
      "precondition",
      `no credentials stored for instance "${name}"`,
      `run: snagentic auth login ${name} (or set ${variable} in CI)`,
    );
  }
}
