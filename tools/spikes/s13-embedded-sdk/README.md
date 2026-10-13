# Spike S13: the ServiceNow SDK's build inside the snagentic binary

Question (product owner, 2026-10-13): the SDK is mandatory for flows, so can it be embedded,
keeping ASR-05 (one executable, only `git` as a prerequisite)? Not product code.

Setup: `@servicenow/sdk` 4.13.6 (MIT), Bun 1.4.3, macOS arm64, the S11 Fluent project (two flows).
`embed.ts` builds a project in-process with the SDK's API; `compile.ts` compiles it into one
binary with `Bun.build`.

## Results

1. **The build has an in-process API.** `new Project({ config, fileSystem, rootDir, logger,
   telemetryClient })` and `new Orchestrator(project).build({})`, with
   `NowConfig.parseFromDirectory`. `rootDir` must be absolute. About 1 s for the S11 project.
2. **Telemetry can be switched off** by passing the SDK's `NoOpTelemetry` (or `NO_TELEMETRY=1`).
   Otherwise the SDK sends usage events to PostHog. The S11 runs of the `now-sdk` CLI did not
   disable it, so they probably sent anonymous usage events.
3. **Output is equivalent to the CLI's.** Flow XML matches `now-sdk build` except the gzip
   encoding of `values` and `trigger_inputs`: the decompressed JSON is identical text. Two Bun
   builds are byte-identical for flows. The SBOM (`sys_module` `bom.json`) has a random serial
   number and a timestamp, so it differs on every build: it must be left out of the plan id or
   normalized (ASR-13). The CLI also writes `package_inventory.csv`; the API does not.
4. **It compiles into one binary, with four bundle-time adjustments** (all in `compile.ts`):
   - `jiti` (optional, used by the bundled ESLint config loader) is external;
   - Rollup's native add-on is replaced by its official WebAssembly build (`@rollup/wasm-node`,
     same version), resolved by a plugin, and its `.wasm` is embedded with Bun's `file` loader;
   - the SDK's external plugin loader (flow, playbook, AI agent, Now Assist), which uses a dynamic
     `require` from disk, is replaced by static requires, as the SDK's own browser bundles do
     (`virtual-loader-template.js`);
   - `fastify-plugin` (loaded by `@servicenow/isomorphic-rollup`) names plugins from stack frames
     it cannot parse inside a binary; patched to fall back to its own default.
   Other native add-ons in the dependency tree were not loaded by a flow build: `@swc/core`,
   `@cyclonedx` (SBOM), `@napi-rs/keyring` and `@parcel/watcher` (CLI only).
5. **With no SDK on disk, the binary builds the flows**, identical to the in-process build.
6. **The project's type declarations are still read from disk.** Fluent resolves
   `action.core.updateRecord` from the `.d.ts` files of `@servicenow/sdk` and `@servicenow/glide`
   in the project's `node_modules`; without them the build fails (`TS213: Failed to cast
   UnresolvedShape to Record`). They are 13 MB, 1 MB compressed. snagentic would embed them and
   supply them, either through the `fileSystem` the API accepts (an overlay) or by writing them
   to an ignored folder in the workspace on first use. **Solved by A1, below.**
7. **Size.** Today's snagentic binary is 66 MB (68 MB of it is Bun's runtime baseline for an empty
   program). The spike binary is 165 MB: the SDK adds about 97 MB, including parts a flow build
   does not need (language server, ESLint, Prettier, UI bundling). Trimming is possible but not
   measured.

## Not covered

- Server modules (`sys_module` scripts) and UI pages, which may load `@swc/core` or Rollup paths
  the flow build did not touch.
- Windows and Linux binaries (ASR-05 platforms).
- Keeping the embedded SDK current: its version would follow snagentic releases.

## A1: type declarations from the binary (flows test plan, 2026-10-13)

- **Every read the build makes under `node_modules` goes through the `fileSystem` passed to
  `Project`** (`trace-fs.ts`): about 800 files of `@servicenow/sdk-core`, 4 of
  `@servicenow/sdk`, 1 of `@servicenow/sdk-build-plugins`, and `@types/estree` and
  `@types/json-schema`. TypeScript's own library files come from inside the bundle.
- `make-types.ts` collects those five packages' `.d.ts`, `.ts` and `package.json` files: 1,347
  files, 8.3 MB, **1.2 MB gzipped**, embedded with Bun's `file` loader.
- `overlay.ts` serves `<project>/node_modules/**` from that asset (`existsSync`, `accessSync`,
  `statSync`, `lstatSync`, `readFileSync`, `readdirSync`, `realpathSync`) and passes every other
  path to the real fs.
- **Result: pass.** A copy of the S11 project with only `package.json`, `now.config.json` and
  `src` (never installed, outside any folder with `node_modules`), built by the compiled binary
  with no `node_modules` anywhere on the machine's paths: success in 0.8 s, output identical to
  the reference after normalizing the SBOM's serial number and timestamp. Binary: 166 MB.
