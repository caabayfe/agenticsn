import {
  EXIT_CODES,
  ensureDevelopmentInstance,
  getInstance,
  InstanceName,
  InvalidInputError,
  OperationCancelledError,
  redactSecrets,
  SnagenticError,
  UNEXPECTED_ERROR_EXIT_CODE,
} from "@snagentic/core";
import { z } from "zod";
import type { RunControl, UseCase, UseCaseContext } from "./use-case";
import { underWorkspaceLock } from "./workspace-lock";
import { workspaceRoot } from "./workspace-root";

export type { ProgressEvent, RunControl } from "./use-case";

const UNCONTROLLED: RunControl = { signal: new AbortController().signal, progress: () => {} };

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

async function handle<O extends z.ZodObject>(
  useCase: UseCase<z.ZodObject, O>,
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

type Declared = Pick<UseCase, "name" | "group" | "flags">;

const named = (useCase: Declared) => [useCase.group, useCase.name].filter(Boolean).join(" ");

// ADR-0012 layer 3: a use case that changes an instance runs only against a development one,
// checked here, once, before any handler can reach the instance.
async function ensureWritableTarget(
  useCase: Declared,
  input: Record<string, unknown>,
  context: UseCaseContext,
): Promise<void> {
  if (!useCase.flags.requiresDevelopmentInstance) {
    return;
  }
  const instance = input["instance"];
  if (typeof instance !== "string") {
    throw new Error(`${useCase.name} changes an instance but has no instance input`);
  }
  const profile = await getInstance(
    await workspaceRoot(context),
    InstanceName.parse(instance),
    context.profiles,
  );
  ensureDevelopmentInstance(profile, named(useCase));
}

// The handler of a use case not declared as changing an instance never gets a write
// connection: the flag and the type are one gate.
function gated(useCase: Declared, context: UseCaseContext): UseCaseContext {
  if (useCase.flags.requiresDevelopmentInstance) {
    return context;
  }
  const openForWrite = () => {
    throw new Error(`${named(useCase)} is not declared as changing an instance`);
  };
  return { ...context, connections: { ...context.connections, openForWrite } };
}

// Validates the input, checks the target, runs the handler and validates its output: the one
// path every call takes, nested ones included.
export async function runUseCase<I extends z.ZodObject, O extends z.ZodObject>(
  useCase: UseCase<I, O>,
  rawInput: unknown,
  context: UseCaseContext,
  run: RunControl = UNCONTROLLED,
): Promise<z.output<O>> {
  const input = useCase.input.safeParse(rawInput);
  if (!input.success) {
    throw new InvalidInputError(z.prettifyError(input.error));
  }
  await ensureWritableTarget(useCase, input.data, context);
  const result = await underWorkspaceLock(useCase, input.data, context, () =>
    handle(useCase, input.data, gated(useCase, context), run),
  );
  const output = useCase.output.safeParse(result);
  if (!output.success) {
    throw new Error(
      `${useCase.name} returned output that does not match its schema: ${z.prettifyError(output.error)}`,
    );
  }
  return output.data;
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
  const output = await runUseCase(useCase, rawInput, context, run);
  return { output, exitCode: useCase.exitCode(output) };
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
