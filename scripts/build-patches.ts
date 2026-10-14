// Bundle-time adjustments that let the ServiceNow SDK run inside one compiled binary (spike S13,
// ADR-0028 as amended). Each asserts its target exists and must apply exactly as expected, so
// an SDK upgrade that moves the target fails the build with the patch's name (flows test plan, A8).
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { BunPlugin } from "bun";

export class PatchError extends Error {
  constructor(patch: string, reason: string) {
    super(`bundle patch "${patch}" no longer applies: ${reason}`);
  }
}

function replaceOnce(patch: string, source: string, target: string, replacement: string): string {
  if (!source.includes(target)) throw new PatchError(patch, `target text not found: ${target}`);
  return source.replace(target, replacement);
}

// Rollup's native add-on is replaced by its official WebAssembly build of the same version,
// with the .wasm embedded through Bun's file loader.
function rollupWasm(applied: Set<string>, wasmNode: string): BunPlugin {
  const name = "rollup-wasm";
  return {
    name,
    setup(build) {
      build.onResolve({ filter: /^rollup(\/.*)?$/ }, (args) => {
        const sub = args.path === "rollup" ? "rollup" : args.path.slice("rollup/".length);
        const path = join(wasmNode, "dist", `${sub}.js`);
        if (!existsSync(path)) throw new PatchError(name, `${path} does not exist`);
        return { path };
      });
      build.onLoad(
        { filter: /wasm-node[\\/]dist[\\/]wasm-node[\\/]bindings_wasm\.js$/ },
        (args) => {
          applied.add(name);
          const wasm = JSON.stringify(join(dirname(args.path), "bindings_wasm_bg.wasm"));
          const source = replaceOnce(
            name,
            readFileSync(args.path, "utf8"),
            // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal source text to replace
            "const wasmPath = `${__dirname}/bindings_wasm_bg.wasm`;",
            "const wasmPath = __embeddedWasm;",
          );
          return { contents: `const __embeddedWasm = require(${wasm});\n${source}`, loader: "js" };
        },
      );
    },
  };
}

// The SDK loads its flow, playbook, AI agent and Now Assist plugins with a dynamic require from
// disk; its own browser bundles use static requires (virtual-loader-template.js). Same here.
const EXTERNAL_PLUGINS: Readonly<Record<string, string>> = {
  "@servicenow/fluent-flow": "./flow.js",
  "@servicenow/sdk-aiaf-plugin": "./aiaf.js",
  "@servicenow/sdk-nowassist-skill-plugin": "./nask.js",
  "@servicenow/sdk-playbook-plugin": "./playbook.js",
};

function staticPluginLoader(applied: Set<string>): BunPlugin {
  const name = "static-plugin-loader";
  return {
    name,
    setup(build) {
      build.onLoad({ filter: /sdk-api[\\/]dist[\\/]external-plugins[\\/]loader\.js$/ }, (args) => {
        applied.add(name);
        if (!readFileSync(args.path, "utf8").includes("loadExternalPlugins")) {
          throw new PatchError(name, "loader.js no longer exports loadExternalPlugins");
        }
        const entries = Object.entries(EXTERNAL_PLUGINS).map(([pkg, file]) => {
          if (!existsSync(join(dirname(args.path), file))) {
            throw new PatchError(name, `${file} is missing next to loader.js`);
          }
          return `  ${JSON.stringify(pkg)}: require(${JSON.stringify(file)}),`;
        });
        const contents = [
          "const STATIC = {",
          ...entries,
          "};",
          "exports.loadExternalPlugins = function (_outputName, npmPackageName) {",
          "  const m = STATIC[npmPackageName];",
          "  if (!m || !m.default) throw new Error('External plugin ' + npmPackageName + ' was not bundled');",
          "  return [m.default].flat();",
          "};",
        ].join("\n");
        return { contents, loader: "js" };
      });
    },
  };
}

// fastify-plugin 5 (the SDK's) names a plugin from its stack frame; frames in a compiled binary
// are paths it cannot parse. Fall back to its own default instead of throwing. Version 6 (used
// elsewhere in the tree) already does, and is left as it is.
const FASTIFY_UNSAFE =
  "return m ? m[1].split(/[/\\\\]/).slice(-1)[0].match(fileNamePattern)[1] : 'anonymous'";
const FASTIFY_SAFE = "if (!m) return 'anonymous'";

function fastifyPluginName(applied: Set<string>): BunPlugin {
  const name = "fastify-plugin-name";
  return {
    name,
    setup(build) {
      build.onLoad({ filter: /fastify-plugin[\\/]lib[\\/]getPluginName\.js$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        if (source.includes(FASTIFY_SAFE)) return undefined;
        applied.add(name);
        const contents = replaceOnce(
          name,
          source,
          FASTIFY_UNSAFE,
          "const f = m && m[1].split(/[/\\\\]/).slice(-1)[0].match(fileNamePattern); return f ? f[1] : 'anonymous'",
        );
        return { contents, loader: "js" };
      });
    },
  };
}

export const PATCH_NAMES = ["rollup-wasm", "static-plugin-loader", "fastify-plugin-name"] as const;

// The plugins, and a check that every patch ran (an SDK that stops loading a patched module
// would otherwise drop the patch silently).
export function sdkBundlePatches(cliPackage: string): {
  plugins: BunPlugin[];
  assertApplied(): void;
} {
  const applied = new Set<string>();
  const fromCli = createRequire(join(cliPackage, "package.json"));
  const wasmNode = dirname(fromCli.resolve("@rollup/wasm-node/package.json"));
  return {
    plugins: [
      rollupWasm(applied, wasmNode),
      staticPluginLoader(applied),
      fastifyPluginName(applied),
    ],
    assertApplied() {
      for (const name of PATCH_NAMES) {
        if (!applied.has(name)) throw new PatchError(name, "its target module was not bundled");
      }
    },
  };
}
