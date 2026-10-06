// A use case is the single definition of one operation (ADR-0003). The CLI command, the MCP
// tool and the JSON output are all generated from it; nothing is defined twice by hand.
import type {
  CredentialStore,
  EnvironmentProbe,
  IncrementalMirror,
  InstanceName,
  InstanceProfile,
  InstanceReader,
  MirrorInspector,
  MirrorIntegrator,
  MirrorMode,
  ProfileStore,
  SyncStateStore,
  TableStatistics,
  WorkspaceStore,
} from "@snagentic/core";
import type { z } from "zod";

export const OUTPUT_FORMATS = ["agent", "json", "text"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];
export type RenderFormat = Exclude<OutputFormat, "json">;

// Facts about the machine and process, resolved once by the composition root.
export interface HostEnvironment {
  readonly cwd: string;
  readonly home: string;
  readonly version: string;
  // --workspace or SNAGENTIC_WORKSPACE; otherwise the workspace is found from cwd.
  readonly workspaceOverride?: string;
}

// Asks the person at the terminal for a secret; never used for agents (MCP).
export interface SecretReader {
  read(prompt: string): Promise<string>;
}

// Opens a connection to an instance; every connection has its own request scheduler.
export interface ConnectionFactory {
  open(profile: InstanceProfile, secret: string): InstanceReader & TableStatistics;
}

// The ports use cases need, wired by the composition root (main.ts).
export interface UseCaseContext {
  readonly environmentProbes: readonly EnvironmentProbe[];
  readonly workspaces: WorkspaceStore;
  readonly profiles: ProfileStore;
  readonly credentials: CredentialStore;
  readonly secrets: SecretReader;
  readonly connections: ConnectionFactory;
  // Per-instance local sync state (.snagentic/<name>/) and the git mirror of a workspace.
  readonly syncState: (root: string, instance: InstanceName) => SyncStateStore;
  readonly mirrors: {
    open(root: string, instance: InstanceName, mode: MirrorMode): Promise<IncrementalMirror>;
  };
  readonly integrator: MirrorIntegrator;
  readonly inspector: MirrorInspector;
  readonly clock: () => Date;
  readonly host: HostEnvironment;
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
  // kebab-case. With a group, the CLI command is `<group> <name>` and the MCP tool
  // `<group>_<name>`; "-" becomes "_" in MCP names.
  readonly name: string;
  readonly group?: string;
  // Written for a model: what the operation is for and when to use it.
  readonly description: string;
  readonly input: Input;
  readonly output: Output;
  readonly flags: UseCaseFlags;
  // Whether the operation earns a place in the MCP tool budget (ADR-0002).
  readonly mcp: boolean;
  // Input fields the CLI takes as positional arguments, in order.
  readonly arguments?: readonly string[];
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
  for (const part of [useCase.name, ...(useCase.group === undefined ? [] : [useCase.group])]) {
    if (!USE_CASE_NAME.test(part)) {
      throw new Error(`use case name must be kebab-case: ${JSON.stringify(part)}`);
    }
  }
  return useCase;
}

export function qualifiedName(useCase: UseCase): string {
  return useCase.group === undefined ? useCase.name : `${useCase.group} ${useCase.name}`;
}

export function mcpToolName(useCase: UseCase): string {
  return qualifiedName(useCase).replaceAll(/[- ]/g, "_");
}

export function isOutputFormat(value: unknown): value is OutputFormat {
  return OUTPUT_FORMATS.some((format) => format === value);
}
