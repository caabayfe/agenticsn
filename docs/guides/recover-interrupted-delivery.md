# Recover an interrupted delivery

A failed push keeps its per-unit receipts in `.snagentic/<instance>/push-journal.json` until
verified delivery and the ledger commit both finish. Normal planning refuses changed source
while a receipt is unfinished. Do not remove that journal or edit the ledgers to bypass it:
recover the delivery as below or, when recovery refuses, abandon it with
`push --abandon-pending`.

If source needed correcting, but the instance already holds the corrected build, use an
explicit receipt-only recovery plan:

```sh
snagentic plan-push --instance pdi --recover-pending
snagentic push --instance pdi --recover-pending --plan <reviewed-plan-id> --confirm
```

Review the first command's result before confirming. Recovery uses the receipt's original
batch label unless one is explicitly supplied, and refuses any different instance URL, alias
or batch. It plans only pending units as `record`; unrelated source changes are left for a
later normal plan. It never plans a create, load, delete or forget operation.

Every pending unit must have its original, open update set. An instance version observed after
the attempted write must remain unchanged. The actual capture payload and live content must both match the current reviewed build;
compiled definitions must also carry the matching published snapshot. A previous `verified`
flag, record name or timestamp alone is insufficient. Missing source, mismatched or unreadable
content, missing captures and closed/renamed update sets refuse recovery.

The confirmation recomputes the plan and its evidence. Its id binds recovery mode, current
source, live versions, the original target, pending receipts and the normal validation gate.
Push loads no metadata, rechecks capture/content, commits the current ledger and clears only
the successfully verified receipts. A failed ledger commit leaves the journal for another
reviewed recovery attempt. Existing preference restoration still runs.

After recovery, generate a fresh normal install or push plan. This keeps resumed accelerator
installs from redirecting an old module receipt into a newly grouped upgrade batch.

One example is a source declaration of a column absent on the target release: the platform
cannot capture that column. Removing the unsupported declaration may make the real capture and
live record agree with source. Recovery proves that agreement without adding schema or weakening
capture verification. If the instance needs another write, receipt-only recovery refuses; restore
the original source and use the normal reviewed delivery path, or investigate the mismatch.

## When recovery refuses: abandon the delivery

Some unfinished deliveries cannot be finished: the record changed on the instance after the
delivery, the original update set is closed or gone, or the journal is a legacy one without
per-unit evidence. The refusal then names the exit, `push --abandon-pending`. It is the only
supported way to drop the journal; still do not remove the file or edit the ledgers by hand.

```sh
snagentic status --instance pdi                                    # shows the unfinished push's id
snagentic push --instance pdi --abandon-pending --plan <unfinished-push-id>
snagentic push --instance pdi --abandon-pending --plan <unfinished-push-id> --confirm
```

The second command refuses, as every push without `--confirm` does, and lists what the stopped
push left on the instance: each record, whether it was applied and captured, written without
being verified, or of unknown outcome, and its update set. Review that list; with `--confirm`
the same command:

- sends **nothing** to the instance. It rolls nothing back: what the stopped push wrote stays
  there, in the update sets listed. Revert a record on the instance yourself if you do not
  want it;
- records the list in a commit on your branch (`chore(snagentic): abandon pending delivery of
  push <id> to <instance>`). The commit changes no file and no ledger;
- clears the pending receipts, so the workspace can plan and push again.

It exists only where `push` does (development instances), holds the instance's workspace lock,
needs no sign-in, and refuses when nothing is pending or when `--plan` is not the unfinished
push. If the stopped push had switched your current application or update set and not restored
them, they stay journaled and the next push restores them.

Then plan again. The ledgers still describe the last verified agreement, so a record the
abandoned push changed appears in the new plan as an ordinary difference: already equal (only
recorded), changed on the instance (pull, then `adopt --refresh`), or to be loaded again.

Where another action exists, the message names it first: restore the source that was pushed, or
plan with the original instance and `--label`.

This supports the ledger agreement and reviewed-plan requirements of
[ADR-0033](../adr/0033-plans-compare-the-build-with-the-instance.md), ASR-02 and ASR-10;
abandoning is [ADR-0050](../adr/0050-push-requires-content-and-durable-capture-evidence.md),
amendment A1.
