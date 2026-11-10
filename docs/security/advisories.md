# Advisory register

Every advisory `bun audit` reports must have a row here with a decision and a review date.
`scripts/check-advisories.ts` fails CI on an advisory missing from this table, or one past its
review date (spec 012, step 2). Remove a row once the audit no longer reports it.

A decision holds for the copies it was made about (spec 014, F2). Each row names the installed
versions the advisory hits (**Versions**) and the direct dependencies of the workspaces that
bring those copies in (**Through**); the check reads both from `bun.lock`. When the advisory is
reported for another version, or reaches snagentic through a dependency the row doesn't name,
the check fails and says what changed: make the decision again for what is installed now. A row
that names more than is still reported only gets a note, so it can be narrowed. `bun audit`'s own
text output names paths by package name only, so it can show paths the lockfile doesn't have:
trust the check's list.

How to decide: fix it with an `overrides` entry in the root `package.json` when a compatible
patched version exists. Otherwise accept it for at most 90 days, with the reason it can't hurt
snagentic, and look again by the review date.

## How the packages reach snagentic (2026-10-22, updated 2026-11-10)

Most of them come in through the ServiceNow SDK (4.14.0 since 2026-11-02), which the binary
embeds (ADR-0032); the others through the MCP server or ESLint, as noted. snagentic calls only `Orchestrator.build` and `Orchestrator.transform`, on
the developer's own project.

- **Fixed by `overrides`** (2026-10-22): `handlebars` 4.7.10, `fastify` 5.12.7, `@fastify/static`
  10.1.7, `joi` 17.13.8, `undici` 7.30.1. This cleared both critical advisories and 25 of 32.
  The real SDK still builds the `doctor` test flow with them.
- `js-yaml` 3.x is no longer reported (2026-11-03): SDK 4.14 builds its SBOM with `xmlbuilder2` 4,
  which doesn't use it, so its rows are gone.
- **`ip-address` 10.7.4** (2026-10-23) overrides 10.7.3, which reaches the MCP server through
  `express-rate-limit` and the SDK through `socks`; both accept `^10`.
- `sprintf-js` is no longer reported (2026-10-23), so its row is gone.
- **`body-parser` 2.4.0** (2026-10-25) overrides 2.3.0, which reaches the MCP server through
  `express` 5 (`^2.2.1`).
- **`fast-uri`** (2026-10-25, paths corrected 2026-11-10) ships twice: 3.1.8 through `ajv` 8
  (`^3.0.1`) and 4.2.2 through `@fastify/ajv-compiler` and `fast-json-stringify` (`^4.0.0`), both
  under the SDK's `fastify`. 3.1.8 also reaches the MCP server: `@modelcontextprotocol/sdk` brings
  its own `ajv` 8. Each major has a fix (3.1.9, 4.2.3), but a Bun override replaces every copy
  with one version, so it can't fix both without forcing a major on one of them. snagentic calls
  only the SDK's build and transform, which give them no URI from an instance; the MCP SDK uses
  `ajv` only to check a client's answer to an elicitation, and snagentic never asks for one. The
  ESLint path `bun audit` prints doesn't exist: both ESLints (snagentic's 10 and the SDK's 9) use
  `ajv` 6, which depends on `uri-js`, not `fast-uri`.
- **`zod` 4.6.7** (2026-11-10) overrides 4.6.5, which SDK 4.14 pins exactly in
  `@servicenow/sdk-api`, `sdk-build-core` and `sdk-build-plugins` (the register's earlier row was
  about the 3.23.8 of SDKs before 4.14). The override moves them two patches to the version
  snagentic itself uses, so one copy is installed. Checked: the real SDK still builds the `doctor`
  test flow (`ServiceNow SDK 4.14.0: built a test flow`, in the sandboxed worker) and the tests that
  drive its build and transform pass (`packages/cli/test/adapters/fluent`, adopt, take-over).
- `braces` is no longer reported (2026-10-25), so its row is gone.
- **`joi` 17.13.9 and `qs` 6.16.1** (2026-11-03) override 17.13.8 and 6.16.0. `joi` is pinned
  by the SDK's `@servicenow/isomorphic-rollup` (17.13.8, so the override moves it one patch);
  `qs` reaches the MCP server through `express` 5 (`^6.14.0`) and `body-parser` (`^6.16.1`).
- **`glob`** (2026-11-03) ships twice: 13.0.6 through the SDK's `@fastify/static` (`^13`) and
  10.5.0 through `cacache`, which comes with the optional `libxmljs2` build tooling (`node-gyp`).
  The only fix is 14.0.2, a major neither accepts. The flaw is a walk that ignores its
  AbortSignal after a timeout; snagentic never serves static files and never runs `node-gyp`.
- **`minimatch`** (2026-11-03) ships as 3.1.5, 9.0.9 and 10.2.6; the advisory hits 9.0.9 (SDK
  `ts-morph`) and 10.2.6 (ESLint, and the SDK's `glob`), not 3.1.5. The only fix is 11.0.1, a
  major none of them accept. The flaw is slow expansion of a hostile
  pattern; the patterns are ESLint's and the SDK's own, and snagentic's script checker builds
  its ESLint configuration in code, so no pattern comes from a workspace or an instance.

## Register

| Advisory | Package | Versions | Through | Severity | Decision | Reason | Review by |
|---|---|---|---|---|---|---|---|
| GHSA-w74x-v6f9-j3xg | fast-uri | 3.1.8, 4.2.2 | `@modelcontextprotocol/sdk`, `@servicenow/sdk`, `@servicenow/sdk-api` | moderate | accepted | Scheme spoofing via percent-encoded schemes; both majors come with the SDK, one override can't fix both; snagentic gives it no URI from an instance, and the MCP SDK uses it only for elicitation, which snagentic never asks for | 2027-02-08 |
| GHSA-wjr9-j795-jxcr | fast-uri | 3.1.8, 4.2.2 | `@modelcontextprotocol/sdk`, `@servicenow/sdk`, `@servicenow/sdk-api` | moderate | accepted | Host confusion in WHATWG host canonicalization; same reason | 2027-02-08 |
| GHSA-xhq7-xmqj-769h | fast-uri | 3.1.8, 4.2.2 | `@modelcontextprotocol/sdk`, `@servicenow/sdk`, `@servicenow/sdk-api` | low | accepted | Path equivalence in relative reference normalization; same reason | 2027-02-08 |
| GHSA-333x-w4r6-6crp | fast-uri | 3.1.8, 4.2.2 | `@modelcontextprotocol/sdk`, `@servicenow/sdk`, `@servicenow/sdk-api` | low | accepted | Scheme injection via a first-segment colon; same reason | 2027-02-08 |
| GHSA-3g3m-2fjr-6pw4 | glob | 10.5.0, 13.0.6 | `@servicenow/sdk`, `@servicenow/sdk-api` | moderate | accepted | AbortSignal cancellation ignored after a timeout; 13.x and 10.x come with the SDK and its optional build tooling, the only fix is a new major; snagentic serves no files and runs no node-gyp | 2027-02-01 |
| GHSA-g3hv-75wg-m249 | minimatch | 9.0.9, 10.2.6 | `@servicenow/sdk`, `@servicenow/sdk-api`, `@servicenow/sdk-build-core`, `eslint` | moderate | accepted | Slow expansion of a hostile pattern; 9.x and 10.x come with ts-morph, ESLint and glob, the only fix is a new major; every pattern is the tools' own or set in code | 2027-02-01 |
