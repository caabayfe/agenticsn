# Advisory register

Every advisory `bun audit` reports must have a row here with a decision and a review date.
`scripts/check-advisories.ts` fails CI on an advisory missing from this table, or one past its
review date (spec 012, step 2). Remove a row once the audit no longer reports it.

How to decide: fix it with an `overrides` entry in the root `package.json` when a compatible
patched version exists. Otherwise accept it for at most 90 days, with the reason it can't hurt
snagentic, and look again by the review date.

## How the packages reach snagentic (2026-10-22, updated 2026-11-03)

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
- **`fast-uri`** (2026-10-25) ships twice through the SDK: 3.1.8 through `ajv` 8 (`^3.0.1`) and
  4.2.2 through `@fastify/ajv-compiler` (`^4.0.0`), both under the SDK's `fastify`. Each major has
  a fix (3.1.9, 4.2.3), but a Bun override replaces every copy with one version, so it can't fix
  both without forcing a major on one of them. snagentic calls only the SDK's build and transform, which
  give them no URI from an instance.
- **`zod` 3.23.8** (2026-10-25) is pinned exactly by `@servicenow/sdk-api`, `sdk-build-core` and
  `sdk-build-plugins`; the advisory has no 3.x fix. The SDK validates its own configuration and the
  developer's project with it. snagentic's own `zod` is 4.6.7, which is not affected.
- `braces` is no longer reported (2026-10-25), so its row is gone.
- **`joi` 17.13.9 and `qs` 6.16.1** (2026-11-03) override 17.13.8 and 6.16.0. `joi` is pinned
  by the SDK's `@servicenow/isomorphic-rollup` (17.13.8, so the override moves it one patch);
  `qs` reaches the MCP server through `express` 5 (`^6.14.0`) and `body-parser` (`^6.16.1`).
- **`glob`** (2026-11-03) ships twice: 13.0.6 through the SDK's `@fastify/static` (`^13`) and
  10.5.0 through `cacache`, which comes with the optional `libxmljs2` build tooling (`node-gyp`).
  The only fix is 14.0.2, a major neither accepts. The flaw is a walk that ignores its
  AbortSignal after a timeout; snagentic never serves static files and never runs `node-gyp`.
- **`minimatch`** (2026-11-03) ships as 3.1.5, 9.0.9 and 10.2.6 (ESLint, `ts-morph`, `glob`). The
  only fix is 11.0.1, a major none of them accept. The flaw is slow expansion of a hostile
  pattern; the patterns are ESLint's and the SDK's own, and snagentic's script checker builds
  its ESLint configuration in code, so no pattern comes from a workspace or an instance.

## Register

| Advisory | Package | Severity | Decision | Reason | Review by |
|---|---|---|---|---|---|
| GHSA-w74x-v6f9-j3xg | fast-uri | moderate | accepted | Scheme spoofing via percent-encoded schemes; both majors come with the SDK, one override can't fix both; snagentic gives it no URI from an instance | 2027-01-23 |
| GHSA-wjr9-j795-jxcr | fast-uri | moderate | accepted | Host confusion in WHATWG host canonicalization; same reason | 2027-01-23 |
| GHSA-xhq7-xmqj-769h | fast-uri | low | accepted | Path equivalence in relative reference normalization; same reason | 2027-01-23 |
| GHSA-333x-w4r6-6crp | fast-uri | low | accepted | Scheme injection via a first-segment colon; same reason | 2027-01-23 |
| GHSA-mrhx-c7xc-m3w5 | zod | high | accepted | Memory exhaustion validating oversized constrained collections; 3.23.8 is pinned by the SDK, no 3.x fix; it validates only the SDK's configuration and the local project | 2027-01-23 |
| GHSA-3g3m-2fjr-6pw4 | glob | moderate | accepted | AbortSignal cancellation ignored after a timeout; 13.x and 10.x come with the SDK and its optional build tooling, the only fix is a new major; snagentic serves no files and runs no node-gyp | 2027-02-01 |
| GHSA-g3hv-75wg-m249 | minimatch | moderate | accepted | Slow expansion of a hostile pattern; 3.x, 9.x and 10.x come with ESLint, ts-morph and glob, the only fix is a new major; every pattern is the tools' own or set in code | 2027-02-01 |
