import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { Orchestrator, Project } from "@servicenow/sdk-api";
import { type Diagnostic, NoOpTelemetry, NowConfig } from "@servicenow/sdk-build-core";
import type { FluentBuildError } from "./fluent-build-error";
import { OverlayFileSystem } from "./overlay-file-system";
import { projectRefusals } from "./project-refusals";
import { type InstanceExchange, SchedulerConnector } from "./scheduler-connector";
import type { TypeFiles } from "./type-files";

// Loaded only for a build: the release binary holds this module as a second entry point, so
// commands that do not build flows never parse the SDK (ADR-0028 as amended, item 6).

export type { FluentBuildError } from "./fluent-build-error";

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
  // How the last build or transform was contained (ADR-0044), when it ran in a worker.
  readonly isolation?: () => string | undefined;
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

type Opened =
  | { readonly project: Project; readonly refused?: undefined }
  | { readonly refused: readonly FluentBuildError[] };

function openProject(
  rootDir: string,
  typeFiles: TypeFiles,
  scratch?: string,
  logger = quietLogger,
): Opened {
  const fileSystem = new OverlayFileSystem(rootDir, typeFiles, scratch);
  const config = NowConfig.parseFromDirectory(rootDir, fileSystem, logger);
  const refused = projectRefusals(config, rootDir);
  if (refused.length > 0) return { refused };
  const project = new Project({
    config,
    fileSystem,
    rootDir,
    logger,
    telemetryClient: new NoOpTelemetry(),
  });
  return { project };
}

async function build(rootDir: string, typeFiles: TypeFiles): Promise<FluentBuildOutcome> {
  const logged: string[] = [];
  const collect = (...parts: unknown[]) => {
    logged.push(...parts.filter((part): part is string => typeof part === "string"));
  };
  const opened = openProject(rootDir, typeFiles, undefined, { ...quietLogger, error: collect });
  if (opened.refused !== undefined) {
    return { success: false, errors: opened.refused };
  }
  const project = opened.project;
  // The SDK throws after reporting diagnostics; the diagnostics are the answer.
  let thrown: unknown = null;
  const result = await new Orchestrator(project).build({}).catch((error: unknown) => {
    thrown = error;
    return undefined;
  });
  if (result?.success) {
    return { success: true, records: result.files.map((f) => toPosix(relative(rootDir, f.path))) };
  }
  const errors = project.getDiagnosticsService().getErrors();
  if (errors.length > 0) return { success: false, errors: errors.map((d) => toError(rootDir, d)) };
  const reasons = logged.map(undiagnosed);
  return { success: false, errors: reasons.length > 0 ? reasons : [undiagnosed(thrown)] };
}

// Some failures reach no diagnostic: the SDK logs them as errors, such as a record two files
// define ("... is defined 2 times in the project:" then "1. <file>:<line>" for each), or only
// throws. The first place named, if any, is the error's file and line.
const PLACE = /^\s*\d+\.\s+(\S+):(\d+)\s*$/;

function undiagnosed(reason: unknown): FluentBuildError {
  const text = reason instanceof Error ? reason.message : String(reason ?? "");
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const place = lines.map((line) => PLACE.exec(line)).find((match) => match !== null);
  const places = lines
    .filter((line) => PLACE.test(line))
    .map((line) => line.trim().replace(/^\d+\.\s+/, ""));
  const first = lines[0]?.trim();
  return {
    file: place?.[1] ?? "",
    line: Number(place?.[2] ?? 0),
    column: 0,
    code: "fluent-build",
    message:
      first === undefined
        ? "the SDK stopped the build without saying why"
        : places.length > 1
          ? `${first} ${places.join(", ")}`
          : first,
  };
}

const TEMP_VARIABLES = ["TMPDIR", "TMP", "TEMP"] as const;

// Runs `body` with the process's temporary folder set to `folder`. The SDK's transform unpacks
// the records it reads into os.tmpdir()/.now/metadata; in the shared /tmp of a Linux host, other
// users could read them there.
async function inTemporaryFolder<T>(folder: string, body: () => Promise<T>): Promise<T> {
  const before = TEMP_VARIABLES.map((name) => process.env[name]);
  for (const name of TEMP_VARIABLES) process.env[name] = folder;
  try {
    return await body();
  } finally {
    TEMP_VARIABLES.forEach((name, i) => {
      const value = before[i];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
  }
}

async function transform(
  rootDir: string,
  typeFiles: TypeFiles,
  records: readonly TransformRecord[],
  connector: SchedulerConnector,
): Promise<FluentTransformOutcome> {
  const scratch = mkdtempSync(join(tmpdir(), "snagentic-sdk-"));
  try {
    return await inTemporaryFolder(scratch, () =>
      transformIn(openProject(rootDir, typeFiles, scratch), rootDir, records, connector),
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function transformIn(
  opened: Opened,
  rootDir: string,
  records: readonly TransformRecord[],
  connector: SchedulerConnector,
): Promise<FluentTransformOutcome> {
  const [refused] = opened.refused ?? [];
  if (opened.refused !== undefined) {
    return { success: false, message: `${refused?.file}: ${refused?.message}` };
  }
  try {
    const result = await new Orchestrator(opened.project, connector).transform({
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
