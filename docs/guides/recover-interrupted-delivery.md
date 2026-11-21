# Recover an interrupted delivery

A failed push keeps its per-unit receipts in `.snagentic/<instance>/push-journal.json` until
verified delivery and the ledger commit both finish. Normal planning refuses changed source
while a receipt is unfinished. Do not remove that journal or edit the ledgers to bypass it.

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

## When nothing finishes the delivery

Some plans are refused with no command that settles them yet: the record changed on the instance
after the delivery, the original update set is closed or gone, or the journal is a legacy one without
per-unit evidence. The message then says so: *no command can finish or abandon this delivery
yet*. Keep the journal, do not edit the ledgers, and ask for help. A reviewed way to abandon an
unfinished delivery is planned (spec 016, step R3) and not built.

Where an action does exist, the message names it: restore the source that was pushed, or plan with
the original instance and `--label`.

This supports the ledger agreement and reviewed-plan requirements of
[ADR-0033](../adr/0033-plans-compare-the-build-with-the-instance.md), ASR-02 and ASR-10.
