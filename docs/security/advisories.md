# Advisory register

Every advisory `bun audit` reports must have a row here with a decision and a review date.
`scripts/check-advisories.ts` fails CI on an advisory missing from this table, or one past its
review date (spec 012, step 2). Remove a row once the audit no longer reports it.

How to decide: fix it with an `overrides` entry in the root `package.json` when a compatible
patched version exists. Otherwise accept it for at most 90 days, with the reason it can't hurt
snagentic, and look again by the review date.

## How the packages reach snagentic (2026-10-22)

All of them come in through the ServiceNow SDK 4.13.6 (the latest release), which the binary
embeds (ADR-0032). snagentic calls only `Orchestrator.build` and `Orchestrator.transform`, on
the developer's own project.

- **Fixed by `overrides`** (2026-10-22): `handlebars` 4.7.10, `fastify` 5.12.7, `@fastify/static`
  10.1.7, `joi` 17.13.8, `undici` 7.30.1. This cleared both critical advisories and 25 of 32.
  The real SDK still builds the `doctor` test flow with them.
- **`js-yaml` 3.14.1** ships in the binary through `xmlbuilder2` 3 in
  `@cyclonedx/cyclonedx-library` (the SDK's SBOM writer). It only matters when parsing YAML,
  and snagentic never gives that library YAML. Bun overrides are top-level only, and `js-yaml`
  4.3.2 is used elsewhere, so 3.x can't be overridden on its own.
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

## Register

| Advisory | Package | Severity | Decision | Reason | Review by |
|---|---|---|---|---|---|
| GHSA-mh29-5h37-fv8m | js-yaml | moderate | accepted | Prototype pollution in merge keys when parsing YAML; the 3.x copy is only reached through the SBOM writer, which never parses YAML | 2027-01-20 |
| GHSA-h67p-54hq-rp68 | js-yaml | moderate | accepted | CPU denial of service when parsing YAML; same reason | 2027-01-20 |
| GHSA-52cp-r559-cp3m | js-yaml | high | accepted | CPU denial of service when parsing YAML; same reason | 2027-01-20 |
| GHSA-5p4m-2wfm-xmqj | js-yaml | high | accepted | CPU denial of service when parsing YAML; same reason | 2027-01-20 |
| GHSA-2883-xcg3-v3hh | js-yaml | high | accepted | CPU denial of service when parsing YAML; same reason | 2027-01-20 |
| GHSA-w74x-v6f9-j3xg | fast-uri | moderate | accepted | Scheme spoofing via percent-encoded schemes; both majors come with the SDK, one override can't fix both; snagentic gives it no URI from an instance | 2027-01-23 |
| GHSA-wjr9-j795-jxcr | fast-uri | moderate | accepted | Host confusion in WHATWG host canonicalization; same reason | 2027-01-23 |
| GHSA-xhq7-xmqj-769h | fast-uri | low | accepted | Path equivalence in relative reference normalization; same reason | 2027-01-23 |
| GHSA-333x-w4r6-6crp | fast-uri | low | accepted | Scheme injection via a first-segment colon; same reason | 2027-01-23 |
| GHSA-mrhx-c7xc-m3w5 | zod | high | accepted | Memory exhaustion validating oversized constrained collections; 3.23.8 is pinned by the SDK, no 3.x fix; it validates only the SDK's configuration and the local project | 2027-01-23 |
