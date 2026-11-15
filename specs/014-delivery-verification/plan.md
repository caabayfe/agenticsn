# P1 delivery verification and recovery

Approved scope: ADR-0050 and the two P1 audit findings. The product owner initially selected
offline validation, then authorized live development-instance acceptance with “use pdi11”.

## Acceptance

- A skipped compiled load plus an old published capture never advances the ledger.
- Draft, missing/unrelated snapshot, changed graph, malformed payload and incomplete publish
  acknowledgements cannot certify delivery. Correct current content succeeds.
- Applied but uncaptured changes retain their old ledger and pending journal, and appear in
  the next plan even when live equals source or an older ledger already advanced.
- Recovery requires a new reviewed plan. It never replays a timed-out write automatically,
  never overwrites a later remote edit, and never switches the pending target or batch.
- Proven captures can reconcile unknown outcomes. Verified writes survive a failed ledger
  commit and do not need another metadata load. Capture is rechecked before recording them.
- Capture through a dictionary still carries a matching label. Default relocation checks
  ownership, scope and content, then reads back the move.
- Durable JSON receipts round-trip through a new store instance; no payload is persisted.
- Repository verification and a build/smoke test of the actual CLI pass offline.

## Recovery

For a current pending journal, retain `.snagentic/<instance>/push-journal.json`. Run
`snagentic plan-push --instance <name> --label <original-label>`, review its operations and
problems, then use its new plan id with `push --confirm`. Prefer the exact suggested next call.
A pending load is an intentional new attempt to obtain capture even if live already equals
source. An unsafe problem requires inspection of the named record and original update set.

For a legacy interrupted journal, inspect its update sets, loaded definitions and the user's
current application/update-set preferences first. Restore preferences deliberately. Keep a
backup of the journal until every delivery is reconciled. Removing a journal alone does not
repair an undeliverable update set.

For a legacy ledger already advanced without capture, first compare source, live content,
published snapshot and target update payload. If they disagree, refresh/adopt the actual live
definition and reconcile the source in git. When source equals live but capture is missing,
recover the matching update into the original development update set through the platform,
then verify its payload. Alternatively, restore the affected ledger to its last known good
git revision and make a deliberate, reviewed source change that generates an update; do not
edit ledger hashes by hand or interpret a no-op plan as capture verification. Promote only
after the update set contains the intended content and published snapshot.

## Additional development-instance checks

The live run below covered publication, changed script/input/name content, missing capture,
fresh-process recovery and refusal after an external edit. Crash injection after load,
publication and before ledger commit, Default relocation and a new dictionary field's carried
label remain covered offline, but were not separately exercised live in this run. Test these
on a dedicated development batch when expanding release/platform compatibility. Record
release-specific payload differences before changing normalization rules.

## Initial offline validation recorded on 2026-11-14

- `bun run verify`: exit 0; typecheck, lint, architecture and size gates passed;
  2,325 tests passed, six opt-in live tests skipped, zero failures.
- Coverage: 99.60% functions, 99.31% lines. The original per-file threshold remains intact.
  Added behavioral tests for existing cleanup, upgrade, hook, documentation and worker
  fallback gaps that otherwise prevented the repository gate from passing.
- `bun run build`: compiled the macOS arm64 CLI; version and plan/push command help passed.
- Started that compiled executable in worker mode with a temporary local flow fixture and
  no credentials. Its embedded SDK built exactly the expected flow record; exit 0.
- No ServiceNow API or development instance was used for these checks. Published lifecycle
  and snapshot examples in the XML tests are synthetic alongside recorded SDK build graphs.

## pdi11 live acceptance, 2026-11-14–15

Target: `dev221240.service-now.com`, development profile `pdi11`, Brazil patch 1; compiled
macOS CLI 2.19.1 with embedded SDK 4.14.0. Used a separate workspace and the dedicated batch
`p1-accept-pdi11-20261114`. No incident or other business record was created. The flow's
record trigger was restricted to a reserved property ID that was never created; the action
only calculates a number. Publication was tested; flow execution was not needed.

- Initial publication wrote all three definitions but correctly retained them as unfinished
  while payload normalization was incomplete. Real captures exposed generated snapshot rows,
  descriptors/defaults and definition references rewritten to snapshot IDs. Added sanitized
  fixtures and both positive and negative regressions before updating normalization.
- After rebuilding, a fresh CLI verified the three captures and live heads, then committed
  their ledgers without another load (`a397560dbf2a1ec7d39f4b1007ac50c4ad4e5ef5`).
- Changed the action calculation from doubling to tripling, flow input from 70 to 71, and
  subflow name. A new reviewed compiled push verified all three with zero mismatches,
  committed `2a78851bd84d277f5e491aae439f569ba3c891f7`, and cleared the journal.
- Withheld only an acceptance property's capture after the real Fluent load. The push
  reported applied but uncaptured, kept the pending journal and made no ledger commit.
  A fresh compiled process offered an explicit load. Its reviewed reload also stayed pending:
  this release did not recapture the unchanged property. Verified the deliberately withheld
  payload against source and live content, restored it to its original test set, then used
  a new record-only plan. Recovery committed `44d57b596c63ae9a239a0423f9f5baf5366237df`
  and cleared the journal. The CLI does not steal captures from arbitrary ignored sets.
- Withheld a second property's capture, saved a reviewed retry plan, then deliberately
  edited that property through the real client in the test's own update set. A fresh plan
  reported an unsafe instance change. The previous reviewed push failed with `plan-changed`;
  the external value and modification count were preserved, and the receipt remained pending.
- Read-only inspection confirmed matching authored graphs in the three published captures
  and restored user preferences. The drift capture in its target set correctly disagreed.
- Cleanup used a separate workspace and reviewed compiled-CLI deletion plans in dependency
  order: flow, subflow, action, then both properties together. Each deletion was applied and
  captured and cleared its pending journal. Final read-back confirmed all five records gone,
  original application/update-set preferences restored, no acceptance captures in the user's
  original update set, and the test/cleanup batches ignored. The blocked drift journal is
  retained as failure evidence in the retired acceptance workspace; it is not a delivery
  success receipt. No customer metadata was deleted.

The fault wrapper changes only capture bookkeeping after the real SDK load; it does not
simulate the server, build, publication, planner, journal, git ledger or HTTP adapters.
Standalone helpers live in `tests/live/p1/` and require explicit invocation. Acceptance logs
and the blocked receipt remain in the isolated workspace's `acceptance/` directory. The
original customer workspace was not edited.

## Final repository verification, 2026-11-15

- `bun run verify`: exit 0; typecheck, lint, architecture and size gates passed;
  2,344 tests passed, six opt-in live tests skipped, zero failures (2,350 total, 292 files).
  The live acceptance above ran explicitly through standalone helpers and the compiled CLI.
- Coverage: 99.60% functions, 99.33% lines; existing coverage thresholds unchanged.
- Added regression coverage for real published payloads, unresolved snapshot references,
  multiple deletion receipt identities, compiled deletion captures and live action state.
- `bun run build`: exit 0, compiled macOS arm64 CLI; `--version` reported 2.19.1. Its embedded
  SDK worker built the five acceptance source units locally with no instance requests.
