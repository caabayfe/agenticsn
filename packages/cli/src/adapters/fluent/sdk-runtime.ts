import { existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { Orchestrator, Project } from "@servicenow/sdk-api";
import { type Diagnostic, NoOpTelemetry, NowConfig } from "@servicenow/sdk-build-core";
import { OverlayFileSystem } from "./overlay-file-system";
import { type InstanceExchange, SchedulerConnector } from "./scheduler-connector";
import type { TypeFiles } from "./type-files";

// Loaded only for a build: the release binary holds this module as a second entry point, so
// commands that do not build flows never parse the SDK (ADR-0028 as amended, item 6).

export interface FluentBuildError {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly code: string;
  readonly message: string;
}

export type FluentBuildOutcome =
  | { readonly success: true; readonly records: readonly string[] }
  | { readonly success: false; readonly errors: readonly FluentBuildError[] };

export interface TransformRecord {
  readonly table: string;
  readonly sysId: string;
}

export type FluentTransformOutcome =
  | { readonly success: true; readonly files: readonly string[] }
  | { readonly success: false; readonly message: string };

export interface FluentRuntime {
  readonly sdkVersion: string;
  build(projectDir: string): Promise<FluentBuildOutcome>;
  // Converts records read from the instance into the project's source (the SDK's transform),
  // with every request sent through `exchange` (ADR-0032).
  transform(
    projectDir: string,
    records: readonly TransformRecord[],
    host: string,
    exchange: InstanceExchange,
  ): Promise<FluentTransformOutcome>;
}

// The SDK also calls success, trace and log, beyond its Logger type.
const ignore = () => {};
const quietLogger = {
  info: ignore,
  warn: ignore,
  error: ignore,
  debug: ignore,
  success: ignore,
  trace: ignore,
  log: ignore,
};

const toPosix = (path: string) => path.split(sep).join("/");

function toError(rootDir: string, diagnostic: Diagnostic): FluentBuildError {
  const { line, character } = diagnostic.asLspDiagnostic().range.start;
  return {
    file: toPosix(relative(rootDir, diagnostic.file.getFilePath())),
    line: line + 1,
    column: character + 1,
    code: `${diagnostic.source}${diagnostic.code}`,
    message: diagnostic.message.split("\n")[0] ?? "",
  };
}

function versionOf(typeFiles: TypeFiles): string {
  const manifest: unknown = JSON.parse(typeFiles.get("@servicenow/sdk/package.json") ?? "{}");
  return typeof manifest === "object" && manifest !== null && "version" in manifest
    ? String(manifest.version)
    : "unknown";
}

function projectAt(rootDir: string, typeFiles: TypeFiles): Project {
  const fileSystem = new OverlayFileSystem(rootDir, typeFiles);
  const config = NowConfig.parseFromDirectory(rootDir, fileSystem, quietLogger);
  return new Project({
    config,
    fileSystem,
    rootDir,
    logger: quietLogger,
    telemetryClient: new NoOpTelemetry(),
  });
}

// The scripts the SDK's build imports and runs: those named in now.config.json, else
// now.<name>.mjs beside it.
const BUILD_SCRIPTS = ["prebuild", "postbuild"] as const;

// A build script would run inside snagentic, with the instance's credentials in reach (S1).
// snagentic builds metadata only; a project with build scripts is refused before the SDK runs.
function buildScripts(project: Project, rootDir: string): FluentBuildError[] {
  const declared: Readonly<Record<string, string>> = project.getConfig().scripts ?? {};
  return BUILD_SCRIPTS.flatMap((name) => {
    const file =
      declared[name] !== undefined
        ? "now.config.json"
        : existsSync(join(rootDir, `now.${name}.mjs`))
          ? `now.${name}.mjs`
          : null;
    return file === null
      ? []
      : [
          {
            file,
            line: 1,
            column: 1,
            code: "snagentic-project-script",
            message: `the project has a ${name} script; snagentic doesn't run project scripts, which would run with its access to the instance: remove it`,
          },
        ];
  });
}

async function build(rootDir: string, typeFiles: TypeFiles): Promise<FluentBuildOutcome> {
  const project = projectAt(rootDir, typeFiles);
  const scripts = buildScripts(project, rootDir);
  if (scripts.length > 0) {
    return { success: false, errors: scripts };
  }
  // The SDK throws after reporting diagnostics; the diagnostics are the answer.
  const result = await new Orchestrator(project).build({}).catch(() => undefined);
  if (result?.success) {
    return { success: true, records: result.files.map((f) => toPosix(relative(rootDir, f.path))) };
  }
  const errors = project.getDiagnosticsService().getErrors();
  return { success: false, errors: errors.map((d) => toError(rootDir, d)) };
}

async function transform(
  rootDir: string,
  typeFiles: TypeFiles,
  records: readonly TransformRecord[],
  connector: SchedulerConnector,
): Promise<FluentTransformOutcome> {
  const project = projectAt(rootDir, typeFiles);
  try {
    const result = await new Orchestrator(project, connector).transform({
      method: "metadata",
      records: records.map(({ table, sysId }) => ({ table, sysId })),
    });
    return {
      success: true,
      files: result.changedFiles.map((f) => toPosix(relative(rootDir, f.getPath()))),
    };
  } catch (error) {
    // The SDK reports a record it cannot read (stale, or out of reach) by throwing.
    if (!(error instanceof Error) || error.name === "SdkRouteRefusedError") throw error;
    return { success: false, message: error.message.split("\n")[0] ?? "" };
  }
}

export function createFluentRuntime(typeFiles: TypeFiles): FluentRuntime {
  // Every SDK telemetry client this process could create is a no-op: snagentic sends no data
  // to third parties (ADR-0028, item 2).
  process.env["NO_TELEMETRY"] = "1";
  return {
    sdkVersion: versionOf(typeFiles),
    build: (projectDir) => build(resolve(projectDir), typeFiles),
    transform: (projectDir, records, host, exchange) =>
      transform(resolve(projectDir), typeFiles, records, new SchedulerConnector(host, exchange)),
  };
}
