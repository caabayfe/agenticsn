import { EXIT_CODES } from "@snagentic/core";
import { Command, CommanderError, Option } from "commander";
import { z } from "zod";
import { addHookCommand } from "../hooks/hook-command";
import { describeError, executeUseCase, type ProgressEvent } from "../registry/execute";
import { MCP_PROFILES, type McpProfile } from "../registry/mcp-profile";
import {
  isOutputFormat,
  OUTPUT_FORMATS,
  type OutputFormat,
  type UseCase,
  type UseCaseContext,
} from "../registry/use-case";
import { commandHelp, configureRootHelp, helpSection } from "./command-help";
import { argumentSyntax, inputDescription, optionsFor } from "./zod-options";

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface CliOptions {
  readonly version: string;
  readonly serveMcp: (profile: McpProfile) => Promise<void>;
  // The process's standard input, for host hooks.
  readonly readStdin?: () => Promise<string>;
  // Aborted on Ctrl-C by the composition root.
  readonly signal?: AbortSignal;
}

const MARK = { done: "✓", skipped: "–", stopped: "✗" } as const;

// Progress goes to stderr in every format, so stdout carries only the result.
function progressLine(event: ProgressEvent): string {
  const count =
    event.completed === undefined
      ? ""
      : ` (${event.completed}${event.total === undefined ? "" : `/${event.total}`})`;
  const mark = event.outcome === undefined ? "…" : MARK[event.outcome];
  return `${"  ".repeat(event.depth ?? 0)}${mark} ${event.message}${count}\n`;
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

// Commander passes positional values first, then the options object.
function inputFrom(
  positional: readonly string[],
  values: readonly unknown[],
): Record<string, unknown> {
  const options = values[positional.length];
  const input: Record<string, unknown> =
    typeof options === "object" && options !== null ? { ...options } : {};
  positional.forEach((key, index) => {
    // A list argument given no values arrives empty: treat it as absent, like any other.
    const value = values[index];
    if (value !== undefined && !(Array.isArray(value) && value.length === 0)) {
      input[key] = value;
    }
  });
  return input;
}

// Use cases with a group become subcommands: `snagentic <group> <name>`.
function parentFor(program: Command, useCase: UseCase): Command {
  if (useCase.group === undefined) {
    return program;
  }
  const existing = program.commands.find((command) => command.name() === useCase.group);
  return (
    existing ??
    program
      .command(useCase.group)
      .description(useCase.help?.group ?? useCase.group)
      .helpGroup(`${useCase.help?.section ?? "Commands"}:`)
  );
}

function withWorkspaceOverride(
  context: UseCaseContext,
  globalOptions: Record<string, unknown>,
): UseCaseContext {
  const workspace = globalOptions["workspace"];
  return typeof workspace === "string"
    ? { ...context, host: { ...context.host, workspaceOverride: workspace } }
    : context;
}

function useCaseCommand(program: Command, useCase: UseCase): Command {
  const positional = useCase.arguments ?? [];
  const command = parentFor(program, useCase).command(useCase.name, {
    hidden: helpSection(useCase) === "Advanced:" || helpSection(useCase) === "Internal:",
  });
  commandHelp(command, useCase);
  for (const key of positional) {
    const field = useCase.input.shape[key];
    command.argument(argumentSyntax(useCase.input, key), field && inputDescription(key, field));
  }
  for (const option of optionsFor(useCase.input, positional, useCase.help?.options)) {
    command.addOption(option);
  }
  command.addOption(
    new Option("--format <format>", "output format").choices(OUTPUT_FORMATS).default("text"),
  );
  return command;
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
    .description("Understand and develop ServiceNow with coding agents, git and guardrails.")
    .version(options.version)
    .exitOverride()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr });

  program
    .command("mcp", { hidden: true })
    .helpGroup("Internal:")
    .summary("Serve MCP tools for coding-agent hosts")
    .description("Serve snagentic's MCP tools over stdio. Agent hosts start this themselves.")
    .addOption(
      new Option("--profile <profile>", "tool surface to expose")
        .choices([...MCP_PROFILES])
        .default("legacy"),
    )
    .action((args) => options.serveMcp(z.enum(MCP_PROFILES).parse(args.profile)));

  addHookCommand(
    program,
    useCases,
    () => withWorkspaceOverride(context, program.opts()),
    options.readStdin ?? (async () => ""),
    (outcome) => {
      io.stdout(outcome.stdout);
      io.stderr(outcome.stderr);
      exitCode = outcome.exitCode;
    },
  );

  program.option("--workspace <path>", "workspace folder (default: found from current folder)");
  configureRootHelp(program, useCases);
  const contextFor = (): UseCaseContext => withWorkspaceOverride(context, program.opts());

  for (const useCase of useCases.filter((candidate) => candidate.cli !== false)) {
    const positional = useCase.arguments ?? [];
    useCaseCommand(program, useCase).action(async (...values: unknown[]) => {
      const input = inputFrom(positional, values);
      exitCode = await runUseCase(useCase, input, contextFor(), io, signal);
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
