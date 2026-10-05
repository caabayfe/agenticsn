// A use case is the single definition of one operation (ADR-0003). The CLI command, the MCP
// tool and the JSON output are all generated from it; nothing is defined twice by hand.
import type { EnvironmentProbe } from "@snagentic/core";
import type { z } from "zod";

export const OUTPUT_FORMATS = ["agent", "json", "text"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];
export type RenderFormat = Exclude<OutputFormat, "json">;

// The ports use cases need, wired by the composition root (main.ts).
export interface UseCaseContext {
  readonly environmentProbes: readonly EnvironmentProbe[];
}

export interface ProgressEvent {
  readonly message: string;
  readonly completed?: number;
  readonly total?: number;
}

// Per-run controls. Cancelling the signal must stop all further work, including requests
// to an instance (ADR-0016).
export interface RunControl {
  readonly signal: AbortSignal;
  progress(event: ProgressEvent): void;
}

export interface UseCaseFlags {
  readonly readOnly: boolean;
  readonly destructive: boolean;
  readonly requiresDevelopmentInstance: boolean;
}

export interface UseCase<
  Input extends z.ZodObject = z.ZodObject,
  Output extends z.ZodObject = z.ZodObject,
> {
  // kebab-case; the MCP tool name is the same with "_" instead of "-".
  readonly name: string;
  // Written for a model: what the operation is for and when to use it.
  readonly description: string;
  readonly input: Input;
  readonly output: Output;
  readonly flags: UseCaseFlags;
  // Whether the operation earns a place in the MCP tool budget (ADR-0002).
  readonly mcp: boolean;
  handle(
    input: z.output<Input>,
    context: UseCaseContext,
    run: RunControl,
  ): Promise<z.output<Output>>;
  render(output: z.output<Output>, format: RenderFormat): string;
  exitCode(output: z.output<Output>): number;
}

const USE_CASE_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function defineUseCase<Input extends z.ZodObject, Output extends z.ZodObject>(
  useCase: UseCase<Input, Output>,
): UseCase<Input, Output> {
  if (!USE_CASE_NAME.test(useCase.name)) {
    throw new Error(`use case name must be kebab-case: ${JSON.stringify(useCase.name)}`);
  }
  return useCase;
}

export function mcpToolName(useCase: UseCase): string {
  return useCase.name.replaceAll("-", "_");
}

export function isOutputFormat(value: unknown): value is OutputFormat {
  return OUTPUT_FORMATS.some((format) => format === value);
}
