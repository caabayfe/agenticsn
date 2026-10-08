# 004. Plan and push to development update sets

- Status: Accepted (decisions reviewed by the owner on 2026-10-07; D3 changed to one batch per
  pull request)
- Implements: ADR-0010 phase 3, ADR-0013 item 1 (push ships with its gate), ADR-0007 (push
  mechanics), ADR-0006 (gate and waivers), ADR-0012 (development instances only)
- Spec 003 step 5: `plan_push`, `push`, and the `servicenow-deliver` skill

## 1. The flow

```
edit files → validate → plan_push → (user approves) → push → pull → integrate
```

`plan_push` computes what would change on the instance, runs the gate, checks collisions with
other open update sets, and returns a **plan id**. `push` takes that id, recomputes the plan,
and writes only if the plan is unchanged, the gate passes, and every record on the instance
still matches the base it was edited from. Afterwards `pull` and `integrate` bring the
instance's version back into git, where it merges cleanly with the edit. A new record is
added on both sides, which git reports as a conflict; `integrate` takes the instance's copy
when it holds every field set locally with the same value (found by the live PDI test).

## 2. What a plan contains

The **base** is the mirror branch (`servicenow-remote/<name>`): the instance as last pulled.
The **target** is the working tree (committed or not), so an agent can push what it just
validated. The working branch must have the mirror integrated (otherwise pushing would revert
the instance's newer changes).

| Change in the working tree | Plan |
|---|---|
| Record file or script changed | **update**: only the fields whose canonical text differs |
| New record file (`_meta` with a new 32-hex `sys_id`, class and scope) | **create** with that `sys_id` |
| Record file deleted | **unsupported**: blocks the plan (decision D2) |
| Child-row files, denied classes, redacted fields | **unsupported**: blocks the plan |

Each change carries: operation, table, sys_id, path, scope, the changed field names, and the
base hash (`_meta.hash` in the mirror). The **plan id** is the first 16 hex characters of the
SHA-256 of the canonical JSON of: the mirror commit, each change with a hash per field value,
the gate's outcome and the waivers' digest. Any edit, pull, finding or waiver changes it.

## 3. The gate

- `validate` with the mirror commit as base: the change's **introduced** findings.
- The gate passes when no `block` finding remains unwaived (ADR-0006).
- **Waivers** in the workspace's `waivers.yaml`: one rule id, one path glob, a reason, an
  approver and an expiry date at most 366 days ahead. Expired or malformed waivers waive
  nothing, and the plan lists them as problems. Waivers are files in git, so a waiver is
  reviewed like code.
- The plan also fails on: unsupported changes, collisions (unless allowed), conflict markers
  in changed files, and a working branch without the mirror integrated.

## 4. Push

Only for development instances (the use case is not registered for others, ADR-0012); only
with `confirm: true` and the plan id from `plan_push`.

1. Recompute the plan; refuse if its id differs, the gate fails or it has problems.
2. Write a **journal** (`.snagentic/<name>/push-journal.json`) before any instance write, and
   update it after each step. Credentials and field values never go in it (only names and
   hashes).
3. Reuse or create the branch's **batch** (D3): the open global update set `snagentic: <label>`
   (label: the git branch, or `--label`), which holds the global changes, and for every other
   scope a child `snagentic: <label> [<scope>]` whose `parent` is the batch. The batch's
   description links the branch's pull request (ADR-0022): `--pr <url>`, or the open one the
   platform's CLI finds, or a draft one `--draft-pr` opens before any instance write. Per scope, make its update set the user's
   current one through
   `sys_user_preference` (`sys_update_set`, or `updateSetForScope<scope id>`), remembering
   the previous value.
4. Per record: read it, recompute its hash with the same rules as pull, and stop if it differs
   from the base ("changed on the instance since the last pull"). Then PATCH the changed
   fields, or POST the new record with its sys_id after checking that sys_id is free.
5. Restore the preference (always, in a `finally`).
6. Verify capture: each written record has a `sys_update_xml` row named `<table>_<sys_id>` in
   the target update set, updated at or after the write.
7. Delete the journal and report the update sets (with links), the records, and `next`:
   `pull`, then `integrate`.

**Writes are never retried** (ADR-0016 retry policy: no retry for POST/PATCH). A write whose
outcome is unknown (timeout, connection lost) stops the push; the journal records it.
**An unfinished journal** (a crash, Ctrl-C) makes the next `plan_push` report it and the next
`push` first restore the remembered preference, then refuse until `pull` has run; records
already written then show as changed on the instance, which the hash check catches.

## 5. Interfaces

| Tool | Reads | Writes | Flags |
|---|---|---|---|
| `plan_push` | workspace, mirror, instance (collisions: open update sets) | nothing | read-only, any instance kind with a mirror |
| `push` | as plan, plus each record | development instance only | destructive; `confirm` required |

Both are MCP tools (budget: 12 → 14, D1 of spec 003). The CLI: `snagentic plan-push` and
`snagentic push --plan <id> --confirm [--label <name>] [--pr <url>] [--allow-collisions]`.

## 6. Decisions (reviewed by the owner, 2026-10-07)

- **D1. Working tree, not only commits.** Agents push what they just validated; the plan id
  binds the exact content. Teams wanting "only reviewed commits" use governed mode (CI pushes
  on merge, ADR-0004), which runs the same push from a clean checkout. "Tested" means the gate
  (validate, waivers, collisions, base hashes); running ATF tests after a push is a candidate
  for a later version and needs an ADR (it is outside ADR-0010).
- **D2. No deletes in v1.1.** Deleting is destructive and rarely right for an agent; the
  platform's way is to deactivate. A deleted file blocks the plan with a hint to restore it
  and set `active: false`.
- **D3. One update-set batch per pull request (changed by the owner).** A branch is a pull
  request, and its changes travel together: one batch named after the branch, reused while
  open. The platform needs one update set per application scope, so the batch is the platform's
  own grouping (update set batching): a global parent holding the global changes, with a child
  per other scope. Two pull requests in one scope get two batches. The link is the name, found
  on the instance, so a teammate or CI pushing the same branch reaches the same batch (an id
  stored on one machine would not); renaming the batch on the instance breaks it. The batch's
  description links the pull request, found or opened by push itself (ADR-0022).
- **D4. Collisions block by default.** A planned record held in another open update set is
  someone else's work in progress; `allowCollisions` overrides it explicitly. Stricter than the
  platform, which captures the record in both update sets without stopping anyone, so that
  whichever is committed last on the target wins. A person sees at most a message; an agent
  would create the conflict silently.
- **D6. New records carry the mirror's file name (found by the evaluation baseline).** An
  agent stopped building a UI policy because it read "never edit child-row files" as "never
  create child records"; UI policy actions are ordinary records with their own folder. The
  instructions now name child-row files exactly (`<record>.children.<table>.yaml`). A second
  agent created the action correctly, but under a file name pull would not give it, which would
  leave two files for one record after the next pull and plan it as new again. Plan first asked
  for the name pull would give; the PDI end-to-end test (2026-10-08) showed no local prediction
  can be right, as pull names files after `sys_name`, which the platform sets on insert (at
  most 40 characters). Now a record is identified by its scope, class folder and sys_id: any
  name will do, the plan matches the mirror's copy by sys_id, and `integrate` keeps the
  instance's file when its copy confirms the local one.
- **D5. Push does not pull.** The deliver skill runs `pull` and `integrate` after `push`;
  push stays the smallest possible write path.

## 7. Tests

- Domain: plan computation (update, create, unsupported), plan id stability, waivers (valid,
  expired, malformed, glob match), gate.
- Application with fakes: preconditions, plan id mismatch, gate failure, hash conflict,
  journal written before writes, preference restored on failure, capture verification,
  unfinished journal recovery, no retry of writes.
- Adapter: Table API writes with `msw` (method, body, no retry).
- Live (opt-in, PDI): push a change to a scratch record into a scratch update set, verify
  capture, restore, and clean up.
