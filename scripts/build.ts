// Compiles the snagentic binary for this platform (ADR-0005), with the ServiceNow SDK's build as
// a second entry point (ADR-0028 as amended, item 6):
// - the SDK and its type files load only when a command builds flows;
// - bytecode, so every command starts without parsing the program (product owner, 2026-10-14);
// - whitespace and syntax minification only: renaming identifiers breaks the SDK's output.
//   bun scripts/build.ts [--outfile dist/snagentic]
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { EMBEDDED_FLUENT_ENTRY } from "../packages/cli/src/adapters/fluent/fluent-runtime-loader";
import { collectTypeFiles, encodeTypeFiles } from "../packages/cli/src/adapters/fluent/type-files";
import { sdkBundlePatches } from "./build-patches";

const root = resolve(import.meta.dir, "..");
const cli = join(root, "packages", "cli");
const fluent = join(cli, "src", "adapters", "fluent");
const outIndex = process.argv.indexOf("--outfile");
const outfile = resolve(
  root,
  outIndex === -1 ? "dist/snagentic" : (process.argv[outIndex + 1] ?? ""),
);
const work = join(root, "dist", ".fluent");
const posix = (path: string) => path.split(sep).join("/");

// The second entry point: the SDK runtime over the type files embedded in the binary.
function writeFluentEntry(): string {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const types = collectTypeFiles(cli);
  writeFileSync(join(work, "fluent-types.json.gz"), encodeTypeFiles(types));
  const entry = join(work, `${EMBEDDED_FLUENT_ENTRY}.ts`);
  writeFileSync(
    entry,
    [
      'import { readFileSync } from "node:fs";',
      'import typesAsset from "./fluent-types.json.gz" with { type: "file" };',
      `import { createFluentRuntime } from ${JSON.stringify(posix(join(fluent, "sdk-runtime.ts")))};`,
      `import { decodeTypeFiles } from ${JSON.stringify(posix(join(fluent, "type-files.ts")))};`,
      "export const runtime = createFluentRuntime(decodeTypeFiles(readFileSync(typesAsset)));",
      "",
    ].join("\n"),
  );
  console.log(`fluent types: ${types.size} files`);
  return entry;
}

const patches = sdkBundlePatches(cli);
const result = await Bun.build({
  entrypoints: [join(cli, "src", "main.ts"), writeFluentEntry()],
  compile: { outfile },
  // Flat names: the main program imports the second entry point as ./fluent-sdk-runtime.js.
  naming: "[name].[ext]",
  format: "esm",
  bytecode: true,
  minify: { whitespace: true, syntax: true, identifiers: false },
  define: { SNAGENTIC_EMBEDDED_FLUENT: "true" },
  // jiti: optional, used by the SDK's bundled ESLint config loader, never by a build.
  external: ["chromium-bidi", "chromium-bidi/*", "jiti", "jiti/package.json"],
  loader: { ".wasm": "file" },
  plugins: patches.plugins,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
patches.assertApplied();
const binary = process.platform === "win32" ? `${outfile}.exe` : outfile;
console.log(`compiled ${posix(binary)} (${(statSync(binary).size / 1024 / 1024).toFixed(1)} MB)`);
