import { EXIT_CODES } from "@snagentic/core";
import { Command, CommanderError, Option } from "commander";
import { describeError, executeUseCase, type ProgressEvent } from "../registry/execute";
import {
  isOutputFormat,
  OUTPUT_FORMATS,
  type OutputFormat,
  type UseCase,
  type UseCaseContext,
} from "../registry/use-case";
import { optionsFor } from "./zod-options";

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface CliOptions {
  readonly version: string;
  readonly serveMcp: () => Promise<void>;
  // Aborted on Ctrl-C by the composition root.
  readonly signal?: AbortSignal;
}

// Progress goes to stderr in every format, so stdout carries only the result.
function progressLine(event: ProgressEvent): string {
  const count =
    event.completed === undefined
      ? ""
      : ` (${event.completed}${event.total === undefined ? "" : `/${event.total}`})`;
  return `… ${event.message}${count}\n`;
}

function printError(error: unknown, format: OutputFormat, io: CliIo): number {
  const described = describeError(error);
  if (format === "json") {
    const { exitCode: _, ...body } = described;
    io.stdout(`${JSON.stringify({ error: body }, null, 2)}\n`);
  } else {
    io.stderr(`error[${described.code}]: ${described.message}\nhint: ${described.hint}\n`);
  }
  return described.exitCode;
}

async function runUseCase(
  useCase: UseCase,
  options: Record<string, unknown>,
  context: UseCaseContext,
  io: CliIo,
  signal: AbortSignal,
): Promise<number> {
  const { format: requestedFormat, ...input } = options;
  const format = isOutputFormat(requestedFormat) ? requestedFormat : "text";
  const run = { signal, progress: (event: ProgressEvent) => io.stderr(progressLine(event)) };
  try {
    const { output, exitCode } = await executeUseCase(useCase, input, context, run);
    const rendered =
      format === "json" ? JSON.stringify(output, null, 2) : useCase.render(output, format);
    io.stdout(`${rendered}\n`);
    return exitCode;
  } catch (error) {
    return printError(error, format, io);
  }
}

// Builds the CLI from the registry. Contains no knowledge of any specific use case.
export async function runCli(
  argv: readonly string[],
  useCases: readonly UseCase[],
  context: UseCaseContext,
  io: CliIo,
  options: CliOptions,
): Promise<number> {
  let exitCode = 0;
  const signal = options.signal ?? new AbortController().signal;
  const program = new Command("snagentic")
    .description("Develop, audit and validate ServiceNow with any coding agent.")
    .version(options.version)
    .exitOverride()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr });

  program
    .command("mcp")
    .description("Serve snagentic's MCP tools over stdio. Agent hosts start this themselves.")
    .action(options.serveMcp);

  for (const useCase of useCases) {
    const command = program.command(useCase.name).description(useCase.description);
    for (const option of optionsFor(useCase.input)) {
      command.addOption(option);
    }
    command.addOption(
      new Option("--format <format>", "output format").choices(OUTPUT_FORMATS).default("text"),
    );
    command.action(async (commandOptions: Record<string, unknown>) => {
      exitCode = await runUseCase(useCase, commandOptions, context, io, signal);
    });
  }

  try {
    await program.parseAsync([...argv], { from: "user" });
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 0 ? 0 : EXIT_CODES.usage;
    }
    throw error;
  }
  return exitCode;
}
