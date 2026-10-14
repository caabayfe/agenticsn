# 005. Flows: test plan for ADR-0028

- Status: Approved by the product owner (2026-10-13)
- Date: 2026-10-13
- Validates: ADR-0028 (flows authored in Fluent, SDK embedded, delivered by push)
- Evidence so far: spikes S11 (`tools/spikes/s11-flow-delivery/`) and S13
  (`tools/spikes/s13-embedded-sdk/`)
- Gate: plan milestone M-1. Track A of spec 005 starts when the "before track A" tests pass.

## 1. What must be true

ADR-0028 makes claims that the spikes showed once, on one machine and one instance. This plan
turns each claim into a repeatable test with a pass criterion, and names where it runs.

| # | Claim | Shown by | Still unproven |
|---|---|---|---|
| C1 | The SDK's build runs inside the snagentic binary with nothing on disk | S13, flows only | Type declarations from the binary; scripts and other Fluent types; Windows and Linux |
| C2 | Builds are deterministic, so plan ids are stable | S13, two runs on macOS | Across platforms; after normalizing the SBOM |
| C3 | Embedding does not cost what users feel | – | Startup latency (ASR-04), size |
| C4 | The SDK sends nothing to third parties | Code reading | A network test |
| C5 | Push delivers a flow published, running, captured in the batch | S11, scoped app, pdi2 | Global scope; failure paths; the inactive window |
| C6 | The batch moves to another instance and the flow runs there | – | Everything |
| C7 | Drift and edits outside source are visible and recoverable | Mirror shape only | Designer edit → pull → `transform` |
| C8 | The undocumented endpoints are watched | – | Contract tests |
| C9 | Agents can author flows that pass the gate | – | Evaluations |

## 2. Tests

Where: **unit** and **integration** run in `bun run verify` (no network); **binary** runs the
compiled `dist/snagentic` in CI on each supported platform; **live** is opt-in
(`SNAGENTIC_LIVE_INSTANCE=pdi2 bun test tests/live`), coordinated with other sessions using the
instance (AGENTS.md).

### A. Embedded build (C1–C4)

| ID | Test | Pass when | Where | When |
|---|---|---|---|---|
| A1 | **Passed 2026-10-13 (spike S13, macOS arm64; overlay `fileSystem`).** **Type declarations from the binary.** Build the S11 fixture project from the compiled binary in a temporary folder with no `node_modules`, the declarations supplied by snagentic (try the `fileSystem` overlay first, then an ignored workspace folder) | Build succeeds; flow records equal the reference build after normalization (A4) | binary | before track A |
| A2 | **Passed 2026-10-14 (11 fixtures, `tests/fixtures/fluent/`; glide types added).** **Fluent coverage fixtures.** One fixture project per kind: flow with flow logic (if, for each), subflow with inputs and outputs, custom action with a script step, stages, scheduled trigger, inbound email trigger, script include and business rule (server modules: the path that may need `@swc/core` or Rollup), cross-scope privilege, a record type the accelerator uses (system property, ACL) | Each builds from the binary; output equals the `now-sdk` CLI's after normalization | binary | before track A |
| A3 | **Passed on macOS arm64, Linux x64 and arm64 (CI 2026-10-14); Windows x64 rerunning after a path fix.** **Platforms.** A1 and A2 on macOS arm64, Linux x64, Linux arm64, Windows x64 (ASR-05) | All pass on every platform | binary, CI matrix | before track A |
| A4 | **Passed 2026-10-14: one machine, and three platforms against the macOS CLI build (A3). Needs `keys.ts` committed (A2).** **Determinism.** Normalization: decompress `values`/`trigger_inputs` and compare JSON; drop the SBOM's serial and timestamp. Two builds on one machine, and builds on two platforms | Normalized outputs byte-identical; plan id identical; a property test over fixture edits shows any source change changes the plan id | unit + binary | before track A |
| A5 | **Passed 2026-10-14 with the SDK as a second entry point (check p95 131 ms, +4%); a lazy import fails (345 ms). Product owner chooses bytecode or not (size).** **Startup latency.** `check --changed` on one file, p95, with the SDK embedded but not loaded (lazy import only in build paths) | ≤ 300 ms p95 (ASR-04), no regression over 1.5.x by more than 10% | binary, CI | before track A |
| A6 | **Size budget.** Measure the binary; strip what a build does not load (language server, ESLint, Prettier, UI dev server) | Product owner sets the budget from the measurement (spike: 165 MB; 1.5.x: 66 MB) | binary | before release |
| A7 | **Passed 2026-10-14 for all eleven fixtures (macOS sandbox, recording proxy, positive control).** **No telemetry, no network.** Build every fixture with outbound network blocked and a recording proxy | Zero outbound connections; build succeeds | integration | before track A |
| A8 | **Patches hold.** Each bundle-time adjustment (Rollup WebAssembly, static plugin loader, `fastify-plugin`, `jiti`) asserts its target text exists and fails the build loudly if not | A deliberate SDK version bump in a branch either passes A1–A4 or fails at bundle time with the patch's name | build script | each SDK upgrade |
| A9 | **Spike passed 2026-10-14 (structured diagnostics: file, line, column, code); the `validate` integration test is product work.** **Errors as findings.** A fixture with a Fluent error (unknown action, wrong data pill type, missing `$id`) | `validate` reports a finding with file, line, the SDK's code (e.g. TS213) and a hint; exit code 1 | integration | before track A |
| A10 | **SDK version mismatch.** A project whose `package.json` names another SDK version | `validate` warns with both versions | unit | with track A |

### B. Delivery on an instance (C5–C8)

| ID | Test | Pass when | Where | When |
|---|---|---|---|---|
| B1 | **Passed 2026-10-14 (configuration project, `fluent/load` into the batch set, published, ran).** **Global scope.** A Fluent project in global with one flow on `incident`; load, select the global batch, publish | Published, runs, one `sys_hub_flow_<id>` record in the global batch set | live | before track A |
| B2 | **Second instance.** Complete the B1 batch and a scoped batch on pdi2; retrieve, preview and commit both on a second PDI | Preview clean; flows published and active there; test records trigger them | live, two PDIs | before release |
| B3 | **Measured 2026-10-14: 9.0 s on pdi2; six triggers in the window lost. Product owner decision.** **Inactive window.** Redeliver an active flow while a script creates matching records every 200 ms | Measured window reported; records created in the window counted. The product owner decides whether a window that loses triggers is acceptable or needs a mitigation | live | before track A |
| B4 | **(a), (c) platform response recorded 2026-10-14 (422 `PUBLISH_FAILED`, flow left a draft); preflight, (b) and (d) are product tests.** **Failure paths.** (a) publishing user in another domain; (b) instance without `activate_flows`; (c) a flow that fails to publish (invalid reference); (d) connection lost between load and publish | (a), (b) refused by `plan_push` before any write; (c) push stops, names the flow and the error, journal holds the rollback context; (d) the next push reports the unfinished journal and refuses until pull | live (a, c), msw (b, d) | before track A |
| B5 | **Passed 2026-10-14 for new and changed flows, a subflow and an action, scoped and global, with the batch set selected before the publish; second writer: product test with fakes.** **Capture.** New flow, changed flow, subflow, action; the platform putting the update in the app's Default set; a second writer switching the user's preferences mid-push | Every update in the batch, or moved there (spec 006 B5), never another user's; a second writer is reported as a capture failure, not silently accepted | live + fakes | before track A |
| B6 | **Rename and removal in source.** Rename a flow; delete a flow; remove an action from a flow | Rename keeps the sys_id (same `$id`). Deleting a flow is refused (spec 004 D2, deactivate instead). A removed action is delivered by the record's `delete_multiple` and shown in the plan | live + unit | with track A |
| B7 | **Drift.** Edit a delivered flow in Flow Designer; pull | Pull reports the flow as changed outside source; `transform` brings it back into the Fluent project as a reviewable diff | live | before release |
| B8 | **Preflight for privileges.** A flow that writes to a table of another scope without a declared cross-scope privilege | `plan_push` finding before any write | integration | with track A |
| B9 | **Contract tests.** `fluent/load` and `activate_flows`: request shape, the 422 per-flow result, the domain error, rollback context | Pass on pdi2; rerun on each platform release | live, `tests/live` | before release, then per platform release |
| B10 | **Passed 2026-10-14 (one publish call; the server orders action, subflow, flows).** **Order.** A flow calling a subflow and a custom action delivered in one push | Actions and subflows published before the flows that use them; one publish call per batch or ordered calls | live | with track A |

### C. Agent usability (C9)

| ID | Test | Pass when | Where | When |
|---|---|---|---|---|
| C1e | **Task evaluation.** "When a P1 incident is created outside business hours, page the on-call group", on a copy of the pdi2 mirror, by Claude Code headless | Agent writes Fluent source (not mirror rows), validates until clean, plans; plan contains one flow. Scored as in spec 003 D4 | eval harness | before release |
| C2e | **Guidance.** The build skill and `advise` point to the embedded SDK documentation for flows | Trigger evaluation passes; no agent edits a mirrored flow row | eval harness | before release |

## 3. Order of work

1. A1, A7, A4 on macOS: they decide whether embedding holds as designed. A failure here reopens
   ADR-0028 item 2 with the product owner.
2. A2, A9, A5, then A3 in CI.
3. Live, after messaging the other session: B1, B3, B4, B5.
4. The gate for track A: every test marked "before track A" passes.
5. With track A: A10, B6, B8, B10. Before release: A6, B2, B7, B9, C1e, C2e.

## 4. Fixtures and records

- Fixture projects in `tests/fixtures/fluent/<case>/`, each with the reference output of the
  `now-sdk` CLI of the pinned version, normalized, committed as golden files.
- Live results go in `tools/spikes/s11-flow-delivery/README.md` until the tests exist in
  `tests/live`, then in the test names.
- Scratch records on PDIs are named `snagentic test …` and live in scratch applications.
