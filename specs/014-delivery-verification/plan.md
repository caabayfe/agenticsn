# P1 delivery verification and recovery

Approved scope: ADR-0050 and the two P1 audit findings. Run offline and compiled-binary
validation only in this session; the product owner selected that option.

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

## Development-instance checks before release (not run here)

Use one authorized development instance, one publishing user and a dedicated test batch.
Deliver a flow, subflow and custom action; export their captured payloads and retain sanitized
fixtures. Confirm trigger/action/input edits reach the compiled snapshot and travel in the
update set. Exercise an applied change whose capture is withheld, then restart the binary,
review/retry and verify capture. Interrupt after load, after publication and before ledger
commit; ensure the new plan reconciles evidence or blocks without replaying writes. Edit a
pending remote definition and confirm drift blocks. Verify Default relocation and a new
dictionary field's carried label. Record release/version-specific payload differences before
changing normalization rules.

## Validation recorded on 2026-11-14

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
