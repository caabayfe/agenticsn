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
- **`braces` 3.0.3** (the latest release) ships through `fast-glob` in `@servicenow/sdk-build-core`.
  Its patterns come from the SDK and the developer's own `now.config.json`, not from an instance.
- **`ip-address` 10.7.4** (2026-10-23) overrides 10.7.3, which reaches the MCP server through
  `express-rate-limit` and the SDK through `socks`; both accept `^10`.
- `sprintf-js` is no longer reported (2026-10-23), so its row is gone.

## Register

| Advisory | Package | Severity | Decision | Reason | Review by |
|---|---|---|---|---|---|
| GHSA-vfj7-8cjw-p6xm | braces | high | accepted | Stack exhaustion from crafted patterns; no fixed release; patterns come only from the SDK and the local project | 2027-01-20 |
| GHSA-mh29-5h37-fv8m | js-yaml | moderate | accepted | Prototype pollution in merge keys when parsing YAML; the 3.x copy is only reached through the SBOM writer, which never parses YAML | 2027-01-20 |
| GHSA-h67p-54hq-rp68 | js-yaml | moderate | accepted | CPU denial of service when parsing YAML; same reason | 2027-01-20 |
| GHSA-52cp-r559-cp3m | js-yaml | high | accepted | CPU denial of service when parsing YAML; same reason | 2027-01-20 |
| GHSA-5p4m-2wfm-xmqj | js-yaml | high | accepted | CPU denial of service when parsing YAML; same reason | 2027-01-20 |
| GHSA-2883-xcg3-v3hh | js-yaml | high | accepted | CPU denial of service when parsing YAML; same reason | 2027-01-20 |
