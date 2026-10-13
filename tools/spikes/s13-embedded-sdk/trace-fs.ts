// Spike S13/A1: which node_modules files does a Fluent build read through the fileSystem it is given?
import * as fs from "node:fs";
import { resolve } from "node:path";
import { Orchestrator, Project } from "@servicenow/sdk-api";
import { NoOpTelemetry, NowConfig } from "@servicenow/sdk-build-core";

// The spike calls the SDK through narrow local types; the SDK ships its own, richer ones.
type BuildOutput = { success: boolean; files?: unknown[] };
type OrchestratorCtor = new (project: unknown) => { build(options: object): Promise<BuildOutput> };
type ProjectCtor = new (options: object) => unknown;
type ConfigParser = { parseFromDirectory(dir: string, fs: unknown, logger: unknown): unknown };
type TelemetryCtor = new () => unknown;

process.env["NO_TELEMETRY"] = "1";
const rootDir = resolve(process.argv[2] ?? ".");
const seen = new Map<string, Set<string>>();
const traced = new Proxy(fs, {
  get(target, prop: string) {
    const value = (target as Record<string, unknown>)[prop];
    if (typeof value !== "function") return value;
    return (...args: unknown[]) => {
      const first = args[0];
      if (typeof first === "string" && first.includes("node_modules")) {
        const set = seen.get(prop) ?? new Set<string>();
        set.add(first.replace(rootDir, "<root>"));
        seen.set(prop, set);
      }
      return (value as (...a: unknown[]) => unknown).apply(target, args);
    };
  },
});
const logger = {
  info() {},
  warn() {},
  error: (m: string) => console.log("error", m),
  debug() {},
  success() {},
  trace() {},
  log() {},
};
const config = (NowConfig as unknown as ConfigParser).parseFromDirectory(rootDir, traced, logger);
const project = new (Project as unknown as ProjectCtor)({
  config,
  fileSystem: traced,
  rootDir,
  logger,
  telemetryClient: new (NoOpTelemetry as unknown as TelemetryCtor)(),
});
const output = await new (Orchestrator as unknown as OrchestratorCtor)(project).build({});
console.log("success", output.success);
for (const [op, paths] of seen) {
  const list = [...paths];
  console.log(op, list.length);
  const pkgs = new Map<string, number>();
  for (const p of list) {
    const m = p.match(/node_modules\/((@[^/]+\/)?[^/]+)/);
    if (m?.[1]) pkgs.set(m[1], (pkgs.get(m[1]) ?? 0) + 1);
  }
  console.log("  packages:", JSON.stringify(Object.fromEntries(pkgs)));
  for (const p of list)
    if (!p.includes("sdk-core/") || op === "readdirSync")
      if (op !== "accessSync") console.log("   ", p);
}
