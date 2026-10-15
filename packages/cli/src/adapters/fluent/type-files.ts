import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

// The files a Fluent build reads from a project's node_modules, keyed by their path under
// node_modules with "/" on every platform (ADR-0028 as amended, item 6).
export type TypeFiles = ReadonlyMap<string, string>;

export const FLUENT_TYPE_PACKAGES = [
  "@servicenow/sdk",
  "@servicenow/sdk-core",
  "@servicenow/sdk-build-plugins",
  "@servicenow/glide",
  "@types/estree",
  "@types/json-schema",
] as const;

// Declarations and sources, and every .json: sdk-core's now.config.json marks the built-in
// actions as a package of their own; without it a build adopts their keys into the project's
// keys.ts (flows test plan, A3).
const KEEP = /(\.d\.ts|\.ts|\.json)$/;

function packageDirectory(name: string, sdkDirectory: string): string {
  const fromSdk = createRequire(join(sdkDirectory, "package.json"));
  return dirname(realpathSync(fromSdk.resolve(`${name}/package.json`)));
}

// Reads the type files from the installed SDK; `from` is a directory that depends on it.
export function collectTypeFiles(from: string): TypeFiles {
  const fromHere = createRequire(join(resolve(from), "package.json"));
  const sdkDirectory = dirname(realpathSync(fromHere.resolve("@servicenow/sdk/package.json")));
  const files = new Map<string, string>();
  for (const name of FLUENT_TYPE_PACKAGES) {
    const root = name === "@servicenow/sdk" ? sdkDirectory : packageDirectory(name, sdkDirectory);
    collectPackage(files, name, root, root);
  }
  return files;
}

function collectPackage(
  files: Map<string, string>,
  name: string,
  root: string,
  directory: string,
): void {
  for (const entry of readdirSync(directory)) {
    const full = join(directory, entry);
    if (entry === "node_modules") continue;
    if (statSync(full).isDirectory()) {
      collectPackage(files, name, root, full);
    } else if (KEEP.test(entry) && !entry.endsWith(".map")) {
      files.set(`${name}/${relative(root, full).split(sep).join("/")}`, readFileSync(full, "utf8"));
    }
  }
}

export function encodeTypeFiles(files: TypeFiles): Uint8Array {
  return gzipSync(JSON.stringify(Object.fromEntries(files)), { level: 9 });
}

export function decodeTypeFiles(bytes: Uint8Array): TypeFiles {
  const parsed: unknown = JSON.parse(gunzipSync(bytes).toString("utf8"));
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("embedded Fluent type files are not an object");
  }
  return new Map(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
