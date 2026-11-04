# 0050. `--demo` runs the demo modules' load jobs once, on development only

- Status: Accepted (product owner, 2026-11-04: "load jobs: yes, load the jobs")
- Date: 2026-11-04
- Requirements: G1, ASR-08, ASR-16
- Amends: 0049 (after the settings, the install also runs the loaders)
- Relates to: 0012 (only development instances are written), 0048 (`--demo` is the one demo
  switch)

## Context

After ADR-0049, a `--demo` install turns on the itsm pack's demo modules (`demo-history`,
`demo-scenarios`), but their data still waits for a person: each loader is an on-demand
scheduled job ("ACC demo: load history", "ACC demo: load scenarios"), and someone must open it and
choose *Execute Now*. The owner asked for `--demo` to run them.

snagentic has no script runner and must not get one (AGENTS.md: no background scripts). The
platform's *Execute Now* does not run the job in the request either: it is a server-side UI
action on scheduled jobs (`sysauto`) that adds a run-once trigger (`sys_trigger`) for the
scheduler to pick up. The UI Action API (`POST /api/now/ui/ui_action/{action}` with the table and
record) presses the same button, as a person's click does. A trigger is not captured in update
sets, so nothing of it is promoted.

**Amended after the first live run (everis2, 2026-11-04):** the first version inserted the
trigger itself through the Table API. Field ACLs dropped its name, document, document key and
type, so it never ran. The install now presses *Execute Now* through the UI Action API: the
platform writes the trigger in full, and the job record is left unchanged (no update, no update
set entry). An instance without an active *Execute Now* action on `sysauto` stops the install.

## Decision

1. **A demo module may declare `demoJobs`:** the names of its on-demand jobs (`sysauto_script`),
   in `module.yaml` (`demoJobs: ["ACC demo: load history"]`). Only a module marked `demo: true`
   may declare them, and a name cannot hold a comma or `^` (an encoded query holds it); otherwise
   it is a manifest problem.
2. **With `--demo`, on a development instance, the install runs each one once,** as *Execute
   Now* does: a run-once trigger at the current time. It runs them after the demo modules'
   settings are on (ADR-0049) and the pack's data is loaded, because the loaders refuse while
   their property is off and read the records the pack loaded. Jobs run in the order of their
   modules, dependencies first.
3. **The install does not wait for them.** A load can take many runs (the history reschedules
   itself, some 26 runs for a year); the step reports them queued, and the instance's system log
   shows their progress.
4. **Once per install:** each run writes demo records, so a resumed install whose journal shows
   the step done does not run them again. A new `--demo` install runs them again; the loaders
   decide what that means (the history continues from its progress, the scenarios start again).
5. **A job the instance lacks stops the install,** as a missing property does in ADR-0049: the
   module did not deliver it.
6. **The plan says so:** the install document names the jobs and that the install does not wait
   for them, and they are part of the plan id.

## Consequences

- A `--demo` install ends with the demo data loading: no manual step is left.
- Running the job is the platform's own scheduler, as an admin's click; snagentic adds no way to
  run code it does not deliver.
- The step's "done" means queued, not loaded: the report says so.
- The packs declare their jobs: itsm `demo-history` and `demo-scenarios` add `demoJobs`, with
  snagentic `>=` the release that has this.

## Alternatives considered

- **A background script or scripted REST endpoint to run the jobs:** a script runner, which
  snagentic does not add.
- **A business rule in the pack that runs the loader when its property turns on:** the pack
  would run code on a property change everywhere it is installed, and the install could not say
  in its plan what runs.
- **Wait for the loads to finish:** a year of history takes many runs; the install would hold the
  session for a background load it cannot speed up.
- **Leave it to the admin (ADR-0049 as it stands):** the manual step this ADR removes.
