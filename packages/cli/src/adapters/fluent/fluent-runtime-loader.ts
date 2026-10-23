import { dirname } from "node:path";
import cliPackage from "../../../package.json" with { type: "json" };
import type { FluentRuntime } from "./sdk-runtime";
import { FLUENT_WORKER_COMMAND } from "./worker-protocol";
import { workerRuntime } from "./worker-runtime";
import { osSandbox } from "./worker-sandbox";

// Defined by the release build (scripts/build.ts): the binary holds the SDK as a second entry
// point with its type files embedded. Run from source, the SDK and its types come from
// node_modules.
declare const SNAGENTIC_EMBEDDED_FLUENT: boolean | undefined;

// The second entry point's name in the binary (scripts/build.ts writes it). Imported by a
// computed specifier so the bundler keeps the SDK out of the main program, which every command
// parses at start-up (flows test plan, A5).
export const EMBEDDED_FLUENT_ENTRY = "fluent-sdk-runtime";

export type LoadFluentRuntime = () => Promise<FluentRuntime>;

function isRuntime(value: unknown): value is FluentRuntime {
  return (
    typeof value === "object" &&
    value !== null &&
    "sdkVersion" in value &&
    typeof value.sdkVersion === "string" &&
    "build" in value &&
    typeof value.build === "function" &&
    "transform" in value &&
    typeof value.transform === "function"
  );
}

export type ImportModule = (specifier: string) => Promise<unknown>;

const importModule: ImportModule = (specifier) => import(specifier);

// The second entry point exports the runtime, built over its embedded type files.
export async function loadEmbeddedRuntime(
  load: ImportModule = importModule,
): Promise<FluentRuntime> {
  const module = await load(["./", EMBEDDED_FLUENT_ENTRY, ".js"].join(""));
  const runtime =
    typeof module === "object" && module !== null && "runtime" in module
      ? module.runtime
      : undefined;
  if (!isRuntime(runtime)) throw new Error("the embedded ServiceNow SDK is incomplete");
  return runtime;
}

async function loadFromSource(): Promise<FluentRuntime> {
  const here = new URL(".", import.meta.url);
  const [{ createFluentRuntime }, { collectTypeFiles }] = await Promise.all([
    import(new URL("sdk-runtime.ts", here).href),
    import(new URL("type-files.ts", here).href),
  ]);
  const runtime: unknown = createFluentRuntime(collectTypeFiles(dirname(Bun.fileURLToPath(here))));
  if (!isRuntime(runtime)) throw new Error("the ServiceNow SDK runtime is incomplete");
  return runtime;
}

let loaded: Promise<FluentRuntime> | undefined;

// Loads the SDK into this process, once, on first use: only the worker does (ADR-0044).
export const loadInProcessRuntime: LoadFluentRuntime = () => {
  loaded ??=
    typeof SNAGENTIC_EMBEDDED_FLUENT === "undefined" ? loadFromSource() : loadEmbeddedRuntime();
  return loaded;
};

// The release binary starts itself in its worker mode; from source, the worker script runs.
function workerCommand(): readonly string[] {
  return typeof SNAGENTIC_EMBEDDED_FLUENT === "undefined"
    ? [process.execPath, Bun.fileURLToPath(new URL("fluent-worker-main.ts", import.meta.url))]
    : [process.execPath, FLUENT_WORKER_COMMAND];
}

let worker: FluentRuntime | undefined;

// The SDK as snagentic uses it: every build and transform in a worker that holds no credential
// (ADR-0044). The SDK is pinned, so its version is the dependency's.
export const loadFluentRuntime: LoadFluentRuntime = async () => {
  worker ??= workerRuntime({
    sdkVersion: cliPackage.dependencies["@servicenow/sdk"],
    command: workerCommand(),
    sandbox: osSandbox(),
    warn: (line) => process.stderr.write(`${line}\n`),
  });
  return worker;
};
