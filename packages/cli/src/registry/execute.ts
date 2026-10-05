import {
  EXIT_CODES,
  InvalidInputError,
  SnagenticError,
  UNEXPECTED_ERROR_EXIT_CODE,
} from "@snagentic/core";
import { z } from "zod";
import type { UseCase, UseCaseContext } from "./use-case";

export interface Execution {
  readonly output: Record<string, unknown>;
  readonly exitCode: number;
}

// The one execution path shared by every interface, so the CLI and MCP cannot diverge.
export async function executeUseCase(
  useCase: UseCase,
  rawInput: unknown,
  context: UseCaseContext,
): Promise<Execution> {
  const input = useCase.input.safeParse(rawInput);
  if (!input.success) {
    throw new InvalidInputError(z.prettifyError(input.error));
  }
  const output = useCase.output.safeParse(await useCase.handle(input.data, context));
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
// Stack traces are never included.
export function describeError(error: unknown): DescribedError {
  if (error instanceof SnagenticError) {
    return {
      code: error.code,
      message: error.message,
      hint: error.hint,
      exitCode: EXIT_CODES[error.category],
    };
  }
  return {
    code: "unexpected",
    message: error instanceof Error ? error.message : String(error),
    hint: "this is a bug in snagentic; please report it with the command you ran",
    exitCode: UNEXPECTED_ERROR_EXIT_CODE,
  };
}
