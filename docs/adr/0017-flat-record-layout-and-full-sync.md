# 0017. Flat record layout and full sync by default

- Status: Accepted
- Date: 2026-10-05
- Requirements: ASR-06, ASR-07, ASR-13, ASR-16
- Amends: 0007 (record layout), 0014 (workspace layout 1)
- Resolves: open question 1 (default mirror scope)

## Context

Spike S7 measured three record layouts on the full PDI mirror (279,983 records). A folder
per record (v1) creates about 315,000 git tree objects. Every commit rewrites the trees of
the records it touches, which is exactly what each incremental pull does. The product
owner also decided that advanced development needs the platform's own behavior, not only
customizations.

## Decision

### Layout (workspace layout 1)

Records are stored flat in their class folder:

```
instances/<name>/metadata/[domains/<domain>/]<scope>/<class>/
  <slug>--<sys_id>.yaml                      fields, identity under the `_meta` key
  <slug>--<sys_id>.<field>.<ext>             each non-empty script, HTML, CSS, XML or JSON field
  <slug>--<sys_id>.children.<table>.yaml     read-only child rows, when the record has any
```

- `_meta` holds identity and provenance (sys_id, class, scope, domain, update name, mod
  count, created and updated by and on) and the content hash. Everything else is a field.
- A field is written to its own file when its dictionary type is script-like and its value
  is not empty; otherwise it stays in the YAML. The set of fields in a record is derived
  from the YAML plus its sibling files, so no file list is stored.
- Paths, slugs and the hash contract are unchanged from ADR-0007.

### Scope

**Every `sys_metadata` class is synced by default, out-of-box records included**, plus child
rows, operational inventory and update sets. Customized-only sync is a configuration
option, not the default.

## Consequences

- Measured gains over v1's layout: 26× fewer folders, a 2.5× smaller repository, `git status`
  13× faster cold, and 4–25× faster `add` and commit after a scattered change.
- Large class folders (41k files for ACLs) are fine for git, tools and agents, but slow in
  graphical file explorers.
- A full PDI mirror is about 2 GB on disk. Making that cheaper is a question of git
  plumbing (milestone M3), not of mirroring less.
- Workspace layout stays at version 1; no workspace holds synced data yet.
