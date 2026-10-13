// Spike S13: build a Fluent project in-process with the SDK's API, telemetry off.
//   bun embed.ts <project dir>
import * as fs from "node:fs";
import { resolve } from "node:path";
import { Orchestrator, Project } from "@servicenow/sdk-api";
import { NoOpTelemetry, NowConfig } from "@servicenow/sdk-build-core";

process.env["NO_TELEMETRY"] = "1";
const rootDir = resolve(process.argv[2] ?? ".");
const logger = {
  info: (m: string) => console.log("info", m),
  warn: (m: string) => console.log("warn", m),
  error: (m: string) => console.log("error", m),
  debug: () => {},
  success: (m: string) => console.log("ok", m),
  trace: () => {},
  log: (m: string) => console.log(m),
};
// biome-ignore lint/suspicious/noExplicitAny: the spike calls the SDK without its types
const telemetryClient = new (NoOpTelemetry as any)();
const started = performance.now();
// biome-ignore lint/suspicious/noExplicitAny: the spike calls the SDK without its types
const config = (NowConfig as any).parseFromDirectory(rootDir, fs, logger);
// biome-ignore lint/suspicious/noExplicitAny: the spike calls the SDK without its types
const project = new (Project as any)({ config, fileSystem: fs, rootDir, logger, telemetryClient });
// biome-ignore lint/suspicious/noExplicitAny: the spike calls the SDK without its types
const output = await new (Orchestrator as any)(project).build({});
console.log(
  "success:",
  output.success,
  "files:",
  output.files?.length,
  "ms:",
  Math.round(performance.now() - started),
);
