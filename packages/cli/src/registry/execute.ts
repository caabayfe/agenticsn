import {
  EXIT_CODES,
  InvalidInputError,
  OperationCancelledError,
  redactSecrets,
  SnagenticError,
  UNEXPECTED_ERROR_EXIT_CODE,
} from "@snagentic/core";
import { z } from "zod";
import type { RunControl, UseCase, UseCaseContext } from "./use-case";

export type { ProgressEvent, RunControl } from "./use-case";

const UNCONTROLLED: RunControl = { signal: new AbortController().signal, progress: () => {} };

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

async function handle(
  useCase: UseCase,
  input: Record<string, unknown>,
  context: UseCaseContext,
  run: RunControl,
): Promise<unknown> {
  if (run.signal.aborted) {
    throw new OperationCancelledError();
  }
  try {
    return await useCase.handle(input, context, run);
  } catch (error) {
    throw isAbort(error, run.signal) ? new OperationCancelledError() : error;
  }
}

export interface Execution {
  readonly output: Record<string, unknown>;
  readonly exitCode: number;
}

// The one execution path shared by every interface, so the CLI and MCP cannot diverge.
export async function executeUseCase(
  useCase: UseCase,
  rawInput: unknown,
  context: UseCaseContext,
  run: RunControl = UNCONTROLLED,
): Promise<Execution> {
  const input = useCase.input.safeParse(rawInput);
  if (!input.success) {
    throw new InvalidInputError(z.prettifyError(input.error));
  }
  const output = useCase.output.safeParse(await handle(useCase, input.data, context, run));
  if (!output.success) {
    throw new Error(
      `${useCase.name} returned output that does not match its schema: ${z.prettifyError(output.error)}`,
    );
  }
  return { output: output.data, exitCode: useCase.exitCode(output.data) };
}

export interface DescribedError {
  readonly code: string;
  readonly message: string;
  readonly hint: string;
  readonly exitCode: number;
}

// Errors as users and agents see them: a stable code, the message and the next action.
// Stack traces are never included, and credentials are always redacted.
export function describeError(error: unknown): DescribedError {
  if (error instanceof SnagenticError) {
    return {
      code: error.code,
      message: redactSecrets(error.message),
      hint: redactSecrets(error.hint),
      exitCode: EXIT_CODES[error.category],
    };
  }
  return {
    code: "unexpected",
    message: redactSecrets(error instanceof Error ? error.message : String(error)),
    hint: "this is a bug in snagentic; please report it with the command you ran",
    exitCode: UNEXPECTED_ERROR_EXIT_CODE,
  };
}
