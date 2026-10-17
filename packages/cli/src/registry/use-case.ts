// A use case is the single definition of one operation (ADR-0003). The CLI command, the MCP
// tool and the JSON output are all generated from it; nothing is defined twice by hand.
import type {
  AuthoringWorkspace,
  CredentialStore,
  DataTemplates,
  DeliveryWorkspace,
  DocumentationSources,
  EnvironmentProbe,
  FluentInstaller,
  FluentProjects,
  FluentToolchain,
  ImportSetWriter,
  IncrementalMirror,
  InstalledBinary,
  InstanceName,
  InstanceProfile,
  InstanceReader,
  InstanceWriter,
  InventoryReader,
  KnowledgeStore,
  MarkdownRenderer,
  MediaTools,
  MirrorFiles,
  MirrorInspector,
  MirrorIntegrator,
  MirrorMode,
  MirrorRecords,
  PackSource,
  PackWorkspace,
  PluginActivator,
  ProfileStore,
  PullRequests,
  PushJournalStore,
  ReleaseSource,
  SdkAccess,
  ServerCostReader,
  SiteOutput,
  SyncStateStore,
  TableStatistics,
  ValidateDependencies,
  WorkspaceFiles,
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
  open(
    profile: InstanceProfile,
    secret: string,
  ): InstanceReader &
    TableStatistics &
    ServerCostReader & {
      readonly plugins: PluginActivator;
      readonly writer: InstanceWriter;
      // fluent/load and flow publishing (ADR-0031); absent from connections that cannot push.
      readonly fluent?: FluentInstaller;
      // Accelerator data loads (ADR-0026); absent from connections that cannot load.
      readonly imports?: ImportSetWriter;
      // The embedded SDK's reads through this connection (ADR-0032); absent where it has none.
      readonly sdkAccess?: (signal: AbortSignal) => SdkAccess;
    };
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
  readonly inventory: InventoryReader;
  // An instance's knowledge index and its files in the workspace.
  readonly knowledge: (
    root: string,
    instance: InstanceName,
  ) => {
    readonly store: KnowledgeStore;
    readonly files: MirrorFiles;
  };
  // What validate checks: the Fluent projects and their build, the instance's mirror (edits
  // to it are refused), and the rule pack. Staged: as the index holds them, for the pre-commit
  // hook.
  readonly governance: (
    root: string,
    instance: InstanceName,
    options?: { readonly staged?: boolean },
  ) => ValidateDependencies;
  // An instance's mirror branch and working tree, for plan and push.
  readonly delivery: (root: string, instance: InstanceName) => DeliveryWorkspace;
  // The accelerator packs snagentic ships (ADR-0026).
  readonly packs: PackSource;
  // Data templates in a directory (accelerator validate-data, load).
  readonly dataTemplates: DataTemplates;
  // The pack branches of one instance in a workspace (accelerator add).
  readonly packWorkspace: (root: string, instance: InstanceName) => PackWorkspace;
  // The workspace's Fluent projects and the embedded SDK that converts and builds them
  // (ADR-0031).
  readonly authoring: (root: string) => {
    readonly workspace: AuthoringWorkspace;
    readonly toolchain: FluentToolchain;
  };
  // Fluent projects under source/, built to check them and write their keys; staged: as the
  // index holds them, for the pre-commit hook.
  readonly fluentProjects: (
    root: string,
    options?: { readonly staged?: boolean },
  ) => FluentProjects;
  // The git platform, for the branch's pull request (ADR-0022).
  readonly pullRequests: (root: string) => PullRequests;
  // Where push journals its progress (.snagentic/<name>/push-journal.json).
  readonly pushJournal: (root: string, instance: InstanceName) => PushJournalStore;
  // Text files inside the workspace (the agent pack).
  readonly workspaceFiles: WorkspaceFiles;
  // New files a use case writes for the person, such as an export; never overwrites.
  readonly files: { create(path: string, content: string): Promise<"created" | "exists"> };
  readonly clock: () => Date;
  readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly host: HostEnvironment;
  // The workspace's documentation, the mirrors it is checked against and its built site
  // (ADR-0034).
  readonly documentation: (root: string) => {
    readonly sources: DocumentationSources;
    readonly mirror: (instance: string) => MirrorRecords;
    readonly markdown: MarkdownRenderer;
    readonly output: SiteOutput;
    readonly media: MediaTools;
    // Serves the built site on 127.0.0.1 until the signal is cancelled.
    serve(port: number, signal: AbortSignal, ready: (url: string) => void): Promise<void>;
  };
  // The running binary and the project's releases, for `upgrade` (ADR-0023).
  readonly upgrade: {
    readonly releases: ReleaseSource;
    readonly binary: InstalledBinary;
    readonly platform: string;
    readonly arch: string;
  };
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
  // The MCP tool's name when it differs from <group>_<name>, as ADR-0002 and the plan name it.
  readonly mcpName?: string;
  // False for an MCP-only use case that gathers several CLI commands into one tool.
  readonly cli?: boolean;
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
  return useCase.mcpName ?? qualifiedName(useCase).replaceAll(/[- ]/g, "_");
}

export function isOutputFormat(value: unknown): value is OutputFormat {
  return OUTPUT_FORMATS.some((format) => format === value);
}
