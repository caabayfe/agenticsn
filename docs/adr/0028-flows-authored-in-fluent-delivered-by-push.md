# 0028. Flows are authored in Fluent and delivered by push, published into the batch

- Status: Accepted (product owner, 2026-10-13); amendment proposed 2026-10-14 (below)
- Date: 2026-10-13
- Requirements: ASR-01, ASR-02, ASR-03, ASR-05, ASR-13, ASR-16; goal G1
- Amends: 0025 (item 2: flow child rows stay read-only, and now have a source), spec 004 (push)
- Relates to: 0005 (TypeScript and Bun), 0011 (enforcement layers), 0026 (accelerators),
  0027 (domains)
- Evidence: spike S11, `tools/spikes/s11-flow-delivery/README.md` (pdi2, Australia patch 7)

## Context

Flows (Flow Designer flows, subflows and actions) are a core capability: the ITSM accelerator
needs them, and so does most feature work. The product owner made flow delivery a gate for
spec 005 (2026-10-13).

snagentic mirrors flows but cannot deliver them. A flow is a `sys_hub_flow` record plus child
rows whose `values` field is gzipped JSON, and it only runs from a compiled snapshot the platform
produces when the flow is published. ADR-0025 kept flow child rows read-only for that reason.

Spike S11 found and proved a route, end to end on pdi2:

| Step | Finding |
|---|---|
| Authoring | The ServiceNow SDK (Fluent, `@servicenow/sdk`, MIT) defines flows, subflows, custom actions, stages and every trigger type in TypeScript. `now-sdk build` works offline. `$id` is hashed into a stable sys_id, so every build of the same source names the same records. |
| Built form | One composite update record per flow (`sys_hub_flow_<id>.xml`) with its trigger and action instances, and `delete_multiple` for removed rows. Built as **draft, inactive, no snapshot**. |
| Load | `POST /api/fluent/load/<scope>` (what `now-sdk install` calls) loads the package into the application, with a rollback context. It writes no update record. It **resets the user's update set preferences** to the application's Default set, and it turns an already published flow back into an inactive draft until the next publish. |
| Publish | `POST /api/now/wfa_fluent/activate_flows?sysparm_transaction_scope=<scope>`, body `{ flows: [{ sys_id, active, state }], actions: [...] }`, publishes and compiles. Part of the ServiceNow IDE application; not in the public REST reference. It fails with `PUBLISH_FAILED` when the user is not in the flow's domain. |
| Runs | Test incidents triggered each delivered version (v1, v2), runs `COMPLETE` within 5 s. |
| Capture | **The publish writes the update record**: one complete record (flow, trigger, actions, logic, variables, inputs, stage and the compiled `sys_hub_flow_snapshot`, active), in the user's current update set for the scope. With push's preferences selected after the load, a never-delivered flow was captured in the scoped batch set. |
| Designer | Delivered flows render in Flow Designer like native ones (trigger, actions, data pills, "Published", domain, application). |
| Mirror | Pull mirrors them as ordinary flow records with child files; no duplicates across redeliveries. |
| Runtime | The first run from a scoped app created a cross-scope privilege (`incident`, Write) on its own. |

Not yet proven: a flow in global scope; moving the batch to a second instance and running it there;
an edit made in the designer coming back to source.

## Decision

1. **Flows are authored in Fluent, as source files in the workspace.** Each application that has
   flows has a Fluent project under `source/<scope>/` (package, `now.config.json`, `src/fluent`).
   The source is the truth for flows, subflows and custom actions; the mirror shows what is
   deployed. Mirrored flow records and their child rows stay read-only (ADR-0025), and the
   protected-paths guard keeps refusing them.

2. **The SDK's build is embedded in the snagentic binary** (product owner, 2026-10-13: the SDK is
   mandatory for flows, so it ships with snagentic; ASR-05 stays one executable plus `git`).
   - `push` and `plan_push` build every Fluent project the branch changed in-process, through the
     SDK's API (`Project`, `Orchestrator`), with its telemetry switched off: snagentic sends no
     data to third parties.
   - The SDK version is the one snagentic was released with, recorded in the plan. A project's
     `package.json` may name a different version; `validate` reports the mismatch.
   - The SDK's type declarations ship inside the binary too, and are supplied to the build, so a
     workspace needs no `node_modules` and no Node.
   - The plan id covers the built records' content (decompressed values), not the gzip encoding,
     and leaves out the SBOM's random serial and timestamp (ASR-13).
   - Spike S13 (`tools/spikes/s13-embedded-sdk/`) compiled the build into one binary and built
     the S11 flows with no SDK on disk, after four bundle-time adjustments. Supplying the type
     declarations from the binary, server modules, and Windows and Linux builds are still to be
     proven before this ships.

3. **Push delivers a flow in four steps, inside the branch's batch,** after the records it depends
   on:
   1. load the built package (`fluent/load`), journaled with its rollback context;
   2. select the batch's update set for the scope, the same way push does for records
      (current application, `updateSetForScope<scope>`, global `sys_update_set`), because the load
      reset them;
   3. publish the flows and actions it loaded (`activate_flows`), immediately after the load, so a
      live flow is inactive for the shortest possible time;
   4. verify capture: each flow's `sys_hub_flow_<id>` update record is in the batch's set. When the
      instance put it in the application's Default set, push moves its own update into the batch
      (spec 006, B5), never anyone else's.
   Load and publish are never retried (ADR-0016). A failed publish leaves the flow inactive; push
   stops, reports the flow and its error, and the journal names the rollback context.

4. **The gate validates the source and the result.** `validate` checks the Fluent source (type
   check and the SDK's build diagnostics) and the built records with the same rules as any record.
   The plan shows each flow as one change ("publish flow X, version N"), not as child rows.

5. **Preconditions are checked before any write** (`plan_push` reports them as problems):
   - the publishing user is in the domain the flow will be created in (ADR-0027);
   - the instance answers `activate_flows` (the ServiceNow IDE application is present);
   - the scope's cross-scope privileges that the flows need are declared in source. A privilege
     the platform would create at run time is a finding, because test and production will block
     it.

6. **Edits made in Flow Designer are drift.** When pull sees a flow whose record changed after the
   last delivery from source, it reports it. The way back is the SDK's `transform` into the Fluent
   project, reviewed as a normal change. snagentic never rewrites the source by itself.

7. **The public endpoints first.** `fluent/load` and `activate_flows` are what ServiceNow's own SDK
   calls. They are not in the public REST reference, so a live contract test (`tests/live`)
   covers both on each new platform release, as ADR-0024 does for elevation. If either breaks,
   push refuses flows with a clear error; it never falls back to writing compiled rows by hand.

## Consequences

- Flows, subflows and custom actions ship from git like the rest of a feature, reviewed as
  readable TypeScript, captured complete in the batch, compiled snapshot included.
- A second authoring format joins the YAML records: Fluent for flows. Agents get it from the SDK's
  own documentation (`now-sdk explain`), which the build skill points to.
- **The binary grows** from 66 MB to about 165 MB in the spike (the SDK adds about 97 MB, including
  a language server, ESLint and Prettier a flow build does not use). Trimming them is follow-up
  work with a size budget.
- **snagentic carries the SDK's upgrades.** A new SDK release (new Fluent APIs, platform
  releases) reaches users only with a snagentic release; the release checklist includes
  updating it and rerunning the flow contract tests.
- **Four bundle-time adjustments** to the SDK (S13) must be kept working on each SDK upgrade, with
  a test that builds a fixture project from the compiled binary.
- Undocumented endpoints in the delivery path, covered by live contract tests.
- A live flow is inactive between load and publish. The window is one request; it is reported in
  the push summary.
- Fluent manages a whole application package. Global-scope flows (needed by global configuration
  in the accelerator) are not yet proven; until they are, flows live in scoped applications and
  trigger on global tables, which the spike showed works.

## Alternatives considered

- **The SDK as a workspace dependency, run with Node.** Simpler and always current, but flows
  would need Node and npm on every machine and in CI, breaking ASR-05 for a core capability.
  Rejected by the product owner.
- **`now-sdk install` as the delivery.** It works, but it resets the user's update set preferences,
  creates no update record of its own, and runs outside push's plan, gate and journal. Rejected as
  the product path; push calls the same two endpoints itself.
- **Edit the mirrored records and child rows, then publish.** Rejected: the child rows' `values` are
  compressed, compiled-from structures; writing them by hand is what ADR-0025 refused.
- **snagentic's own flow format, compiled by snagentic.** Rejected: re-implements ServiceNow's
  compiler, and would drift from it on every release.
- **Update set XML through a remote update set and the CI/CD commit API.** Not needed: the publish
  already captures the complete flow in the batch. Kept as the route for moving a batch between
  instances (spec 004 promotion), to be proven with a second instance.
- **Flow Designer's internal API (`/api/now/processflow`).** Rejected: it serves the designer's UI,
  and nothing in the route needs it.
- **Rewrite flows as business rules and scripts.** Rejected by the product owner (2026-10-13):
  flows are a core capability.

## Proposed amendment (2026-10-14, awaiting the product owner)

The flows test plan (`specs/005-itsm-accelerator/flows-test-plan.md`) found facts that change
parts of this decision. Evidence: `tools/spikes/s11-flow-delivery/README.md` (live tests on pdi2)
and `tools/spikes/s13-embedded-sdk/README.md` (A1–A9). Until the product owner accepts it, the
decision above stands.

1. **Load route (corrects Context and item 3.1).** `fluent/load` is the SDK's route for projects of
   type `configuration`, not for app packages: `now-sdk install` of a `package` project installs the
   zipped app through `sn_appclient_upload_processor.do`. Proposed: each Fluent project under
   `source/<scope>/` is a `configuration` project; push loads its records with
   `POST /api/fluent/load/<scopeId>?targetUpdateSetId=<batch set>`. The update record lands in the
   batch set and the user's preferences are untouched. Proven for global (B1) and scoped flows.
   Application records (`sys_app`, modules) stay YAML records delivered by push as today
   (ADR-0025).
2. **Order (item 3).** Select the batch set for the scope, then load, then publish, then restore.
   The publish writes the published record in the user's preferred set, replacing the load's draft
   when that is the batch set.
3. **Capture by content (item 3.4).** After a load the batch set already holds a draft record of the
   same name. Push verifies each flow's record in the batch set is the published one (status,
   snapshot), not just that it exists.
4. **Inactive window (Consequences).** Redelivering a live flow left it inactive for 9 s on pdi2,
   and triggers in that window were lost, not queued (B3). Push reports the window and the records
   that matched the trigger meanwhile. The product owner decides whether that is acceptable on
   development instances; moved update sets carry the published flow (B2 to prove).
5. **sys_ids (Context).** `$id` is not hashed: the first build of a new `$id` picks a random sys_id
   and writes it to `src/fluent/generated/keys.ts`. `keys.ts` is source and is committed;
   `plan_push` builds in a copy and refuses when the build would change `keys.ts` ("commit the
   generated keys"), so plan and push name the same records. The gate also refuses delete records outside
   the project's own keys: a polluted `keys.ts` makes the SDK emit deletes of platform records
   (281 for built-in action choices and documentation, test A3).
6. **Packaging (item 2 and Consequences).** The SDK is a second entry point in the binary, loaded only
   for a build. A lazy `import()` is not enough: it put `check` at 345 ms p95. Identifiers are not
   minified (renaming them breaks the SDK's output). The embedded types include
   `@servicenow/glide`. Size 155 MB, or 216 MB with bytecode, which halves every command's
   start-up: the product owner chooses.
7. **Domain preflight (item 5).** The platform refuses a publish by a user outside the flow's domain
   with 422 `PUBLISH_FAILED` and leaves the flow a draft. `plan_push` compares the domains of the
   flows it redelivers with the publishing user's before any write.
