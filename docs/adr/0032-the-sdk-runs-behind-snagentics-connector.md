# 0032. The SDK runs in-process, behind snagentic's connector

- Status: Accepted (product owner, 2026-10-16; amended by 0044), after spike S17 G1 passed on pdi2
  (`tools/spikes/s17-sdk-connector/README.md`)
- Date: 2026-10-16
- Requirements: ASR-02, ASR-08, ASR-15, ASR-16
- Relates to: 0016 (instance load), 0021 (OAuth), 0028 (the embedded SDK), 0031 (Fluent authoring)
- Plan: `specs/008-fluent-authoring/plan.md`

## Context

ADR-0031 makes the ServiceNow SDK the only way records are authored. `adopt` uses the SDK's
`transform --table --id` to read records from the instance. If the SDK is run as ServiceNow ships
it, it makes its own HTTP calls with a credential in its environment:

- its requests bypass the request scheduler, so they bypass the rate limit, the budget and
  cancellation (ADR-0016);
- the credential leaves snagentic's process;
- nothing stops an SDK command from writing to the instance.

snagentic already runs the SDK's build in-process (`sdk-runtime.ts`). The SDK's `Orchestrator`
accepts an `IConnector` in place of a credential (`sdk-api/dist/orchestrator.d.ts`, 4.13.6). An
`IConnector` is one `fetch(path, init, params)` method. In 4.13.6, transform reads through
`sn_glider/metadata/unload`, `sn_glider/fluent_support/table_relationship_exporter` and Table API
reads.

## Decision

1. **The SDK runs only in snagentic's process.** No `now-sdk` child process, and no SDK
   credential.
2. **Its instance access is snagentic's `InstanceConnector`.** This is an `IConnector` over
   `ServiceNowClient`. Every request goes through the instance's scheduler, honours the use
   case's cancellation signal, and counts against its budget.
3. **The connector passes an allow-list of read routes, and refuses anything else.** In 4.13.6
   that is `GET` reads plus two read-only exports: `table_relationship_exporter` and
   `metadata/unload`. S17 saw transform call only the first (137 records, 5 requests). The list
   is held in one place. A refused route is a
   `SnagenticError` naming the route, so an SDK upgrade that adds one fails loudly in the
   contract test.
4. **Loads stay snagentic's.** `fluent/load` and flow publish remain `FluentInstaller` calls
   from push. The SDK never installs or deploys.
5. **Upgrades.** The SDK is pinned. Each upgrade reruns the connector contract test: transform
   of a fixture record against a recorded instance. It also reruns the live round trip.

## Consequences

- One request policy, one credential store and one cancellation model, whoever makes the call.
- The SDK cannot write, by construction rather than by convention.
- `adopt` could in future read from test or production instances, because the connector is
  read-only. That is not in 2.0, since the ledger base is per development instance.
- snagentic depends on the SDK's `IConnector` and `Orchestrator`, which are not documented as
  public. The adapter is one file, and the contract test catches changes.

## Alternatives considered

- **Run `now-sdk` as a child process with the credential in its environment.** S16 did this.
  Rejected: it breaks ADR-0016 and leaks the credential to another program.
- **A local proxy that injects authentication.** It works with any SDK packaging, but it adds a
  listening socket and a second request path. Not needed while the in-process connector works.
- **Fetch the XML ourselves, then run `transform --from` offline.** This is the fallback if the
  connector API changes. It means re-implementing the SDK's choice of related records per table.
