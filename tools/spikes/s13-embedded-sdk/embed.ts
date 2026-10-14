// Spike S13: build a Fluent project in-process with the SDK's API, telemetry off.
//   bun embed.ts <project dir>
// S13_TELEMETRY_CONTROL=1 leaves the SDK's own telemetry on: the positive control for A7 only.
import * as fs from "node:fs";
import { relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";
import { Orchestrator, Project } from "@servicenow/sdk-api";
import { NoOpTelemetry, NowConfig, TelemetryFactory } from "@servicenow/sdk-build-core";
import { overlayFs } from "./overlay";
import { traced } from "./trace-calls";
// @ts-expect-error spike: Bun embeds the asset and returns its path
import typesAsset from "./types.json.gz" with { type: "file" };

// The spike calls the SDK through narrow local types; the SDK ships its own, richer ones.
type BuildOutput = { success: boolean; files?: unknown[] };
type OrchestratorCtor = new (project: unknown) => { build(options: object): Promise<BuildOutput> };
type ProjectCtor = new (options: object) => unknown;
type ConfigParser = { parseFromDirectory(dir: string, fs: unknown, logger: unknown): unknown };
type TelemetryCtor = new () => unknown;
type Telemetry = { capture(event: string, properties?: object): void; shutdown(): Promise<void> };
type TelemetryMaker = { create(options: object): Telemetry };
type Diagnostic = {
  source: string;
  code: number;
  message: string;
  file?: { getFilePath(): string };
  asLspDiagnostic(): { range: { start: { line: number; character: number } } };
};
type Diagnostics = { diagnostics: { getErrors(): Diagnostic[] } };

const control = process.env["S13_TELEMETRY_CONTROL"] === "1";
if (!control) process.env["NO_TELEMETRY"] = "1";
const rootDir = resolve(process.argv[2] ?? ".");
const files = JSON.parse(gunzipSync(fs.readFileSync(typesAsset)).toString("utf8"));
// S13_REAL_FS=1: the project's own node_modules through the real fs, no overlay (A3 diagnosis).
const base = process.env["S13_REAL_FS"] === "1" ? fs : overlayFs(rootDir, files);
const tracing = process.env["S13_TRACE"] === "1" ? traced(base) : undefined;
const fileSystem = tracing?.fs ?? base;
const logger = {
  info: (m: string) => console.log("info", m),
  warn: (m: string) => console.log("warn", m),
  error: (m: string) => console.log("error", m),
  debug: () => {},
  success: (m: string) => console.log("ok", m),
  trace: () => {},
  log: (m: string) => console.log(m),
};
const telemetryClient = control
  ? (TelemetryFactory as unknown as TelemetryMaker).create({ type: "node" })
  : new (NoOpTelemetry as unknown as TelemetryCtor)();
const started = performance.now();
const config = (NowConfig as unknown as ConfigParser).parseFromDirectory(
  rootDir,
  fileSystem,
  logger,
);
const project = new (Project as unknown as ProjectCtor)({
  config,
  fileSystem,
  rootDir,
  logger,
  telemetryClient,
});
const output = await new (Orchestrator as unknown as OrchestratorCtor)(project)
  .build({})
  .catch((): BuildOutput => ({ success: false }));
console.log(
  "success:",
  output.success,
  "files:",
  output.files?.length,
  "ms:",
  Math.round(performance.now() - started),
);
if (control) {
  (telemetryClient as Telemetry).capture("s13_a7_control");
  await (telemetryClient as Telemetry).shutdown();
}
// Test A9: each error as one structured line, the shape `validate` would turn into a finding.
if (!output.success) {
  for (const d of (project as Diagnostics).diagnostics.getErrors()) {
    const { line, character } = d.asLspDiagnostic().range.start;
    const finding = {
      file: relative(rootDir, d.file?.getFilePath() ?? "")
        .split(sep)
        .join("/"),
      line: line + 1,
      column: character + 1,
      code: `${d.source}${d.code}`,
      message: d.message.split("\n")[0],
    };
    console.log("finding", JSON.stringify(finding));
  }
  process.exitCode = 1;
}
tracing?.report();
