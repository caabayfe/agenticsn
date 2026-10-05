# 0007. Keep the v1 disk format, mirror branch and hash contract

- Status: Accepted, pending the hash-parity spike
- Date: 2026-10-05
- Requirements: ASR-01, ASR-02, ASR-07, ASR-13

## Context

The v1 storage design works well and is what agents read. Changing it would invalidate
existing mirrors for no benefit.

## Decision

Keep the v1 layout:

```
instances/<name>/
  instance.yaml                      # non-secret profile
  metadata/[domains/<domain>/]<scope>/<sys_class_name>/<slug>--<sys_id>/
    _meta.yaml                       # sys_id, class, scope, update name, mod count, hash
    record.yaml                      # normalized, redacted fields
    <field>.<ext>                    # script/html/css/xml/json fields as files
    _children/<table>.yaml           # read-only child rows
  model/tables/<table>.yaml          # derived: effective behavior per table
  update-sets/<state>/<slug>--<sys_id>/
.snagentic/<name>/                   # local, disposable: state, index, caches, locks
git branch servicenow-remote/<name>  # remote state only; written with git plumbing
```

- **Hash contract v1:**
  `sha256(canonical_json({"class": <sys_class_name>, "fields": {k: canonical_text(v)}}))`.
  `canonical_text` converts CRLF and CR to LF and strips trailing newlines. Bookkeeping
  fields are excluded. Exploded files are `canonical_text + "\n"`.
- **The mirror branch** is committed through a private index and work tree (git plumbing),
  so the user's working tree and index are never touched.
- **`integrate`** merges the mirror branch with `git merge --no-ff`. Git's three-way merge
  is the reconciliation engine.
- **Push** creates or reuses `snagentic: <label> [<scope>]` update sets. It switches the
  integration user's current update set through `sys_user_preference` and restores it
  afterwards, checks optimistic concurrency against the plan's base hash, and verifies
  capture in `sys_update_xml`.

## Consequences

- **First test target:** `tests/fixtures/hash-vectors.json`, ported from v1, must pass
  byte for byte (spike).
- The YAML writer must be deterministic: key order, quoting, line endings.
- The v1 algorithms (keyset paging, delete detection, child-table resolution, quarantine)
  are ported as behavior, with their tests used as specifications.

## Alternatives considered

- **A new storage format** (for example, a single JSON file per record). Rejected. It
  breaks compatibility and makes scripts worse for agents to read and diff.
