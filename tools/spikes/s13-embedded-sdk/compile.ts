// Spike S13: compile embed.ts into one binary, with Rollup's native add-on replaced by its
// official WebAssembly build.
//   bun compile.ts [entry] [outfile] [--minify]
import { dirname, join } from "node:path";

const wasm = dirname(require.resolve("@rollup/wasm-node/package.json"));
const [entry = "./embed.ts", outfile = "./embed-bin", ...more] = process.argv
  .slice(2)
  .filter((a) => !a.startsWith("--"));
// --minify, or --minify=whitespace,syntax,identifiers for a subset.
function minifyOption(): boolean | Record<string, boolean> {
  const flag = process.argv.find((a) => a.startsWith("--minify"));
  if (flag === undefined) return false;
  if (flag === "--minify") return true;
  const parts = flag.slice("--minify=".length).split(",");
  return Object.fromEntries(
    ["whitespace", "syntax", "identifiers"].map((p) => [p, parts.includes(p)]),
  );
}

const result = await Bun.build({
  entrypoints: [entry, ...more],
  compile: { outfile },
  minify: minifyOption(),
  ...(process.argv.includes("--bytecode") ? { bytecode: true, format: "esm" as const } : {}),
  // chromium-bidi: as snagentic's own build (package.json "build").
  external: ["jiti", "jiti/package.json", "chromium-bidi", "chromium-bidi/*"],
  loader: { ".wasm": "file" },
  plugins: [
    {
      name: "rollup-wasm",
      setup(build) {
        build.onResolve({ filter: /^rollup(\/.*)?$/ }, (args) => {
          const sub =
            args.path === "rollup"
              ? "dist/rollup.js"
              : `dist${args.path.slice("rollup".length)}.js`;
          return { path: join(wasm, sub) };
        });
        // Rollup's WebAssembly build reads its .wasm next to itself; embed it in the binary.
        build.onLoad({ filter: /wasm-node[\\/]bindings_wasm\.js$/ }, async (args) => {
          const source = await Bun.file(args.path).text();
          const wasmFile = join(dirname(args.path), "bindings_wasm_bg.wasm");
          return {
            contents:
              `const __embeddedWasm = require(${JSON.stringify(wasmFile)});\n` +
              source.replace(
                // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal source text to replace
                "const wasmPath = `${__dirname}/bindings_wasm_bg.wasm`;",
                "const wasmPath = __embeddedWasm;",
              ),
            loader: "js",
          };
        });
        // The SDK loads its flow, playbook, AI agent and Now Assist plugins with a dynamic
        // require from disk. Its own browser bundles replace the loader with static imports
        // (virtual-loader-template.js); this does the same, so they are inside the binary.
        build.onLoad({ filter: /sdk-api[\\/]dist[\\/]external-plugins[\\/]loader\.js$/ }, () => ({
          contents: [
            "const STATIC = {",
            "  '@servicenow/fluent-flow': require('./flow.js'),",
            "  '@servicenow/sdk-aiaf-plugin': require('./aiaf.js'),",
            "  '@servicenow/sdk-nowassist-skill-plugin': require('./nask.js'),",
            "  '@servicenow/sdk-playbook-plugin': require('./playbook.js'),",
            "};",
            "exports.loadExternalPlugins = function (_outputName, npmPackageName) {",
            "  const m = STATIC[npmPackageName];",
            "  if (!m || !m.default) throw new Error('External plugin ' + npmPackageName + ' was not bundled');",
            "  return [m.default].flat();",
            "};",
          ].join("\n"),
          loader: "js",
        }));
        // fastify-plugin names a plugin from its stack frame; frames in a compiled binary are
        // /$bunfs paths it cannot parse. Fall back to its own default instead of throwing.
        build.onLoad({ filter: /fastify-plugin[\\/]lib[\\/]getPluginName\.js$/ }, async (args) => {
          const source = await Bun.file(args.path).text();
          return {
            contents: source.replace(
              "return m ? m[1].split(/[/\\\\]/).slice(-1)[0].match(fileNamePattern)[1] : 'anonymous'",
              "const f = m && m[1].split(/[/\\\\]/).slice(-1)[0].match(fileNamePattern); return f ? f[1] : 'anonymous'",
            ),
            loader: "js",
          };
        });
      },
    },
  ],
});
console.log(
  "ok:",
  result.success,
  result.logs
    .filter((l) => l.level === "error")
    .map((l) => l.message)
    .slice(0, 5),
);
