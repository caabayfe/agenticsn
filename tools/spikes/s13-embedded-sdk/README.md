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

## A7: no telemetry, no network (flows test plan, 2026-10-14)

`no-network.ts` runs each build inside a macOS sandbox (`sandbox-exec`) that denies all outbound
network except a local recording proxy; the proxy logs each request (`CONNECT host:port`) and
refuses it, so nothing leaves the machine.

| Run | Result |
|---|---|
| Control: direct connection by IP (`curl https://1.1.1.1`) | Refused by the sandbox (the same request outside it answers) |
| Control: the binary with the SDK's own telemetry left on (`S13_TELEMETRY_CONTROL=1`) | Build succeeds; the proxy records 8 `CONNECT sdk-a.service-now.com:443` (PostHog), all refused |
| The binary as snagentic would run it, proxy variables set | Build succeeds in 0.7 s; **0 requests** |
| The same, no proxy variables | Build succeeds; **0 requests**, no sandbox denial |

**Result: pass** for the S11 project. The A2 fixtures rerun it when they exist.

## A4: determinism on one machine (flows test plan, 2026-10-14)

`normalize.ts` is the normalization a plan id would hash: gzipped field values replaced by their
text, the SBOM's serial number and timestamp dropped, only the `*.xml` records counted.
`determinism.ts` builds from the binary and compares digests.

- Two builds from the binary: same digest.
- The binary's build and the `now-sdk` CLI's (`ref/`, Node): same digest, and the earlier spike
  builds have it too.
- Six edits that change what is delivered (an action value and a trigger condition, both inside
  gzipped fields; the flow name; run as; the trigger type; an action's `$id`): each changes the
  digest, and no two give the same one.
- A comment edit and a whitespace edit leave the digest unchanged: a plan id follows what is
  delivered, not how the source is formatted.

**Result: pass on macOS arm64.** Across platforms is part of A3 (CI). The product test is a
`fast-check` property over generated edits, with the normalization as a unit under test.

## A2: Fluent coverage (flows test plan, 2026-10-14)

Eleven projects in `tests/fixtures/fluent/` (flow logic, subflow, custom action with a script step,
stages, scheduled and inbound email triggers, script include and business rule from a TypeScript
server module, cross-scope privileges, a property and an ACL, all together, S11), each with the
`now-sdk` CLI's build (Node, telemetry off) as `expected/`. `fixtures.ts` builds each from the
binary in a folder with no `node_modules`, twice, and compares the normalized records.

- **Result: pass**, all eleven, after adding `@servicenow/glide` to the embedded types (server
  modules import it; asset 2,815 files, 1.35 MB gzipped). Server modules compiled inside the binary
  without `@swc/core` or Rollup's native add-on.
- **`Now.ID` sys_ids are not hashes.** A new `$id` gets a random sys_id on its first build, which
  the build writes into `src/fluent/generated/keys.ts` in the project's source. Two first builds
  without it give different records; with it, every build is identical. `keys.ts` is source and
  must be committed (ADR-0028 says "hashed": to amend).

## A9: errors (2026-10-14)

`Orchestrator.build` returns `{ success: false }` with an empty `diagnostics` list; the errors are in
the project's diagnostics store (`source` `ts` or `fluent`, `code`, `message`, file, LSP range).
`embed.ts` prints each as `finding {"file","line","column","code","message"}` and exits 1. The
fixture `tests/fixtures/fluent-errors/a9` gives seven: unknown action (`ts2551`, `fluent213`), missing
`$id` (`ts2769`, `fluent213`), wrong pill type and unknown field (`ts2345`, `ts2339`). Gaps for the
product: a valid pill type that does not match its input is not reported (a gate rule could); some
`fluent213` messages contain a random sys_id when `keys.ts` is missing; some `ts` messages are very
long.

## A5: start-up (2026-10-14)

`latency.ts` against the pdi2 workspace, 40–50 alternating rounds, macOS arm64 (developer machine):

| Binary | Size | `--version` p95 | `check <file>` p95 |
|---|---|---|---|
| snagentic 1.5.0 (`bun run build`) | 74 MB | 78–102 ms | 123–147 ms |
| SDK behind a lazy `import()` | 163 MB | 284 ms | **345 ms** (fails ASR-04) |
| SDK as a second entry point (`with-sdk-split.ts`) | 155 MB | 84 ms | 131 ms (+4%) |
| Second entry point, bytecode | 216 MB | 22 ms | 58 ms |

- A lazy `import()` does not keep the SDK off the start-up path: the compiled program is parsed whole.
  A second entry point in the binary, imported by a computed path, is loaded only for a build.
- **Identifier minification breaks the SDK's output** (a flow build gains 180 spurious delete
  records: built-in action definitions are no longer recognized). Whitespace and syntax
  minification are safe. The release build must not rename identifiers in the SDK's code.
- CI (A3), `--version` p95 with the second entry point, against snagentic: Linux x64 +5%, Linux
  arm64 +8%, macOS arm64 +20% (shared runners, 30 runs).

## A3: platforms (2026-10-14)

`build.yml` builds the binary and runs `fixtures.ts` on each platform. macOS arm64, Linux x64 and
Linux arm64: all eleven fixtures pass and equal the CLI's output built on macOS, so the normalized
output is identical across platforms (A4). Windows x64 failed first: the embedded types were keyed
with `\`; keys now use `/` and Windows paths compare without case.
