import { dirname } from "node:path";
import type { FluentRuntime } from "./sdk-runtime";

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
    typeof value.build === "function"
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

// Loads the SDK once per process, on first use.
export const loadFluentRuntime: LoadFluentRuntime = () => {
  loaded ??=
    typeof SNAGENTIC_EMBEDDED_FLUENT === "undefined" ? loadFromSource() : loadEmbeddedRuntime();
  return loaded;
};
