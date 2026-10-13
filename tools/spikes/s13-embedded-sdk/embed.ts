// Spike S13: build a Fluent project in-process with the SDK's API, telemetry off.
//   bun embed.ts <project dir>
import * as fs from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { Orchestrator, Project } from "@servicenow/sdk-api";
import { NoOpTelemetry, NowConfig } from "@servicenow/sdk-build-core";
import { overlayFs } from "./overlay";
// @ts-expect-error spike: Bun embeds the asset and returns its path
import typesAsset from "./types.json.gz" with { type: "file" };

// The spike calls the SDK through narrow local types; the SDK ships its own, richer ones.
type BuildOutput = { success: boolean; files?: unknown[] };
type OrchestratorCtor = new (project: unknown) => { build(options: object): Promise<BuildOutput> };
type ProjectCtor = new (options: object) => unknown;
type ConfigParser = { parseFromDirectory(dir: string, fs: unknown, logger: unknown): unknown };
type TelemetryCtor = new () => unknown;

process.env["NO_TELEMETRY"] = "1";
const rootDir = resolve(process.argv[2] ?? ".");
const files = JSON.parse(gunzipSync(fs.readFileSync(typesAsset)).toString("utf8"));
const fileSystem = overlayFs(rootDir, files);
const logger = {
  info: (m: string) => console.log("info", m),
  warn: (m: string) => console.log("warn", m),
  error: (m: string) => console.log("error", m),
  debug: () => {},
  success: (m: string) => console.log("ok", m),
  trace: () => {},
  log: (m: string) => console.log(m),
};
const telemetryClient = new (NoOpTelemetry as unknown as TelemetryCtor)();
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
const output = await new (Orchestrator as unknown as OrchestratorCtor)(project).build({});
console.log(
  "success:",
  output.success,
  "files:",
  output.files?.length,
  "ms:",
  Math.round(performance.now() - started),
);
