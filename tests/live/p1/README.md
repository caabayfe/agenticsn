# Explicit P1 live acceptance harness

These standalone scripts document the 2026-11-14–15 acceptance run, outside the default
test suite. They use real credentials and write development metadata. The connection helper
requires development profile `pdi11` at `dev221240.service-now.com`; record names and cleanup
IDs are pinned to this run. This is an audit harness, not a general-purpose test runner.

The run used a new workspace `spaces/pdi11-p1-delivery-20261114`, copied only the connection
profile, and ran the compiled `dist/snagentic`. Existing customer source was not changed.
Never run these scripts concurrently with another writer using the same publishing user.

Sequence used:

1. `preferences.ts` saved the original application/update-set preference values.
2. `setup.ts` initialized isolated source from `tests/fixtures/p1-delivery/`, generated keys,
   committed source and saved a plan. The reviewed plan was pushed with the compiled CLI.
3. `inspect.ts` saved built/captured XML and live head evidence. `save-fixtures.ts` retained
   the initial three captures, sanitized for offline regressions. Later captures were kept
   in the isolated workspace, rather than overwriting the initial fixtures.
4. `update.ts` changed script, input and name; its reviewed plan was pushed with the CLI.
5. `fault.ts <workspace> missing` wrapped the real load to move only the newly written test
   property's capture to a dedicated ignored quarantine. A fresh compiled CLI offered a retry.
   The reviewed retry did not regenerate capture and correctly remained pending.
6. `repair-withheld.ts` verified the exact withheld payload against source and live content,
   restored it to the original test set and saved a new record-only plan. That plan was
   reviewed and pushed with the CLI. This repairs the injected fault; it is not automatic
   product recovery from arbitrary ignored update sets.
7. `fault.ts <workspace> drift` withheld a second property's capture. `remote-edit.ts` saved
   a reviewed retry, deliberately edited only that property in its own test set, restored
   preferences, then verified that a new plan blocked and the old push was refused without
   changing the external value or version. The blocked receipt was retained.
8. `cleanup.ts <workspace> prepare` validated all five exact record identities, archived the
   blocked receipt, prepared a separate cleanup workspace and ignored the test batches.
   The `flow`, `subflow`, `action`, then `properties` phases used reviewed compiled deletion
   plans. `verify` checked absence, original preferences and isolation from the original
   update set, then ignored the cleanup batch. Update history was retained.

Do not rerun setup or a fault phase in an existing workspace. Inspect saved evidence and
journals before resuming an interrupted phase. The retired acceptance workspace intentionally
retains the drift failure journal; clearing it is not a way to certify delivery.

See `specs/014-delivery-verification/plan.md` for outcomes and the scenarios tested only
offline. No flows were executed and no business records were created during this run.
