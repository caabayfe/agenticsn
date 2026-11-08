# 0049. `--demo` turns on the demo modules it installs, on development only, never promoted

- Status: Accepted (product owner, 2026-11-03: "--demo enables the properties")
- Date: 2026-11-03
- Requirements: G1, ASR-08
- Amends: 0048, section 3 ("Their loaders stay behind a property that is off as installed")
- Amended by: 0050 (`--demo` also runs the demo modules' load jobs)
- Relates to: 0012 (only development instances are written), 0047 (development settings in an
  update set that is never promoted)

## Context

The itsm pack's demo modules (`demo-history`, `demo-scenarios`) load and remove synthetic records.
Their loaders refuse unless a property is `true`, such as `nttdata.acc.demo_history.allowed`. Each
module ships its property as `false`, so its update set can never turn the loaders on in test or
production. After a `--demo` install, someone still had to turn the property on by hand before
the demo had its data.

ADR-0048 put demo modules in the normal profiles, installed only with `--demo`, and kept the
property off as installed. The product owner asked for `--demo` to turn them on.

## Decision

1. **A demo module may declare `demoSettings`:** system properties and the values it needs, in
   `module.yaml` (`demoSettings: { nttdata.acc.demo_history.allowed: "true" }`). Only a module
   marked `demo: true` may declare them; on any other module it is a manifest problem.
2. **With `--demo`, on a development instance, the install sets them** after the modules are
   delivered and before the data loads, so the module's own update set (which ships the
   property off) never overwrites them. A property already at its value is not written.
3. **Never promoted:** they are written as ADR-0047's settings are, in an update set of their
   own, `snagentic: demo settings (development only)`, set to `ignore` once written, with the
   user's current application and update set put back.
4. **The plan says so:** the install document lists each property and its value, and they are
   part of the plan id.
5. **`--demo` is for development instances only:** a plan with `--demo` for any other kind is a
   problem that stops it. The install is registered for development instances only (0012); the
   plan refuses as well, so no other caller can plan demo content for test or production.

## Consequences

- A `--demo` install is ready for the demo without a manual step.
- The module's property stays `false` in its update set: promoted, it keeps the loaders off.
- A re-install with `--demo` sets the properties again if someone turned them off.
- A later install with `--data` leaves the demo modules out and does not touch their properties.

## Alternatives considered

- **Ship the property `true` in the module:** it would travel to test and production with the
  update set.
- **Turn them on from the pack's demo data:** data loads are business records, and a property
  written by a load would land in the user's current update set.
- **Leave them to the admin (ADR-0048 as it stands):** the manual step this ADR removes.
