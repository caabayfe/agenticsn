import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

// ADR-0044, item 7: where the SDK's build and transform load code by a computed name. A new place
// could load code from the project, as its Prettier config loader did (spec 012, #145). When an SDK
// upgrade changes this list, review each change, then update the recording.
//
// Reviewed for 4.13.6 (2026-10-23):
// - prettier/config-loader.js: the project's Prettier config; refused before the SDK runs
//   (project-refusals.ts), and the worker holds no credential.
// - external-plugins/loader.js: the SDK's own bundled plugins, from its install folder.
// - util/script-runner.js: prebuild and postbuild scripts; refused before the SDK runs.
// - util/resolve-aiux-sdk.js: an aiux.json makes the build resolve @servicenow/aiux-sdk. It
//   resolves from the SDK's location, not the project's: a planted node_modules/@servicenow/
//   aiux-sdk did not run (checked by hand).
// - template-hooks.js, default-ui-build.js, default-ui-dev.js: init and UI commands, not called.
// - table-plugin.js: element.import(child), an XML call, not a module load.
const RECORDING = join(import.meta.dir, "../../../../../tests/fixtures/sdk/code-loading.json");
const PACKAGES = [
  "@servicenow/sdk-api",
  "@servicenow/sdk-build-core",
  "@servicenow/sdk-build-plugins",
  "@servicenow/sdk-core",
];
const COMPUTED_LOAD = /\b(?:import|require)\(\s*(?!['")])/g;

// A package's folder, looked up as Node does from snagentic or from an SDK package found before it:
// the SDK's own packages are its dependencies, not snagentic's, and some export no entry point.
function packageDir(name: string, bases: readonly string[]): string {
  for (const base of bases) {
    for (let dir = base; dir !== dirname(dir); dir = dirname(dir)) {
      const candidate = join(dir, "node_modules", name);
      if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    }
  }
  throw new Error(`${name} is not installed`);
}

function* scripts(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") yield* scripts(path);
    else if (/\.c?js$/.test(entry.name)) yield path;
  }
}

function computedLoads(): Record<string, number> {
  const found: Record<string, number> = {};
  const bases = [join(import.meta.dir, "../../..")];
  for (const name of PACKAGES) {
    const root = packageDir(name, bases);
    bases.push(root);
    for (const file of scripts(join(root, "dist"))) {
      const count = readFileSync(file, "utf8").match(COMPUTED_LOAD)?.length ?? 0;
      if (count > 0) found[`${name}/${relative(root, file).split(sep).join("/")}`] = count;
    }
  }
  return found;
}

describe("the SDK's code loading", () => {
  it("is where it was when last reviewed", () => {
    expect(computedLoads()).toEqual(JSON.parse(readFileSync(RECORDING, "utf8")));
  });
});
