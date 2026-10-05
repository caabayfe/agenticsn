// Error model (ADR-0003): every expected failure has a stable code, a category that fixes
// its exit code, and a hint naming the next action for the user or agent.

export const ERROR_CATEGORIES = [
  "findings",
  "usage",
  "precondition",
  "remote",
  "not-permitted",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export const EXIT_CODES: Readonly<Record<ErrorCategory, number>> = {
  findings: 1,
  usage: 2,
  precondition: 3,
  remote: 4,
  "not-permitted": 5,
};

export const UNEXPECTED_ERROR_EXIT_CODE = 70;

export abstract class SnagenticError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly hint: string;

  protected constructor(code: string, category: ErrorCategory, message: string, hint: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.category = category;
    this.hint = hint;
  }
}

export function exitCodeFor(error: unknown): number {
  return error instanceof SnagenticError ? EXIT_CODES[error.category] : UNEXPECTED_ERROR_EXIT_CODE;
}

export type InvalidIdentifierCode = "invalid-sys-id" | "invalid-table-name";

export class InvalidIdentifierError extends SnagenticError {
  constructor(code: InvalidIdentifierCode, value: string) {
    const kind = code === "invalid-sys-id" ? "sys_id" : "table name";
    super(
      code,
      "usage",
      `invalid ${kind}: ${JSON.stringify(value)}`,
      `check the ${kind}; it may contain characters ServiceNow does not allow`,
    );
  }
}

export class InvalidInputError extends SnagenticError {
  constructor(message: string) {
    super(
      "invalid-input",
      "usage",
      message,
      "run the command with --help to see the expected input",
    );
  }
}
