import { relative, resolve, sep } from "node:path";
import { Orchestrator, Project } from "@servicenow/sdk-api";
import { type Diagnostic, NoOpTelemetry, NowConfig } from "@servicenow/sdk-build-core";
import { OverlayFileSystem } from "./overlay-file-system";
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

export interface FluentRuntime {
  readonly sdkVersion: string;
  build(projectDir: string): Promise<FluentBuildOutcome>;
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

async function build(rootDir: string, typeFiles: TypeFiles): Promise<FluentBuildOutcome> {
  const fileSystem = new OverlayFileSystem(rootDir, typeFiles);
  const config = NowConfig.parseFromDirectory(rootDir, fileSystem, quietLogger);
  const project = new Project({
    config,
    fileSystem,
    rootDir,
    logger: quietLogger,
    telemetryClient: new NoOpTelemetry(),
  });
  // The SDK throws after reporting diagnostics; the diagnostics are the answer.
  const result = await new Orchestrator(project).build({}).catch(() => undefined);
  if (result?.success) {
    return { success: true, records: result.files.map((f) => toPosix(relative(rootDir, f.path))) };
  }
  const errors = project.getDiagnosticsService().getErrors();
  return { success: false, errors: errors.map((d) => toError(rootDir, d)) };
}

export function createFluentRuntime(typeFiles: TypeFiles): FluentRuntime {
  // Every SDK telemetry client this process could create is a no-op: snagentic sends no data
  // to third parties (ADR-0028, item 2).
  process.env["NO_TELEMETRY"] = "1";
  return {
    sdkVersion: versionOf(typeFiles),
    build: (projectDir) => build(resolve(projectDir), typeFiles),
  };
}
