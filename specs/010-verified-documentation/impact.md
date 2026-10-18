# 010e. Documentation impact of a change (ADR-0039)

- Status: slice 1 built (2026-10-18), ADR-0039 proposed
- Decision: `docs/adr/0039-a-change-shows-what-it-does-to-the-documentation.md`

## 1. What a reviewer gets

`snagentic docs impact --base origin/main` prints Markdown that CI can post on the pull request
unchanged:

```markdown
## Documentation impact

1 claim(s) on 1 page(s) may no longer be true, from source changed since origin/main and from changes on the instance.

### Employees

- [Report an incident](documentation/processes/incident/use/report.md) › In Employee Center (recommended): "Attach screenshots if you have them. Press Submit. (Save as Draft keeps it for later.)"
  E18 `sc_cat_item_producer/3f1dd0320a0a0b99000a53f7604a2ef9#no_attachment_v2`, changed on the instance since the page was checked
```

The agent reads the same report with `--format json` and fixes each claim in the same change.

## 2. How it is computed

| Step | Where | Rule |
|---|---|---|
| Records the source changes | governance, `checkSince` (shared with `validate`) | Units added or edited since `base`; for an edit, the fields whose value changed |
| Evidence the change affects | documentation, `documentationLookup.citing` | Record evidence: always. Field evidence: only when the field changed. Children evidence: only when the record is added or deleted |
| Evidence the instance changed | documentation, `documentationLookup.stale` | The hash in the mirror differs from the pin, or the record is gone (as `docs check`) |
| Claims | documentation, `claimsOf` (domain) | Each paragraph, list item (with its continuation lines) or table row citing the evidence, outside code; its innermost heading; its reader |

Readers: Use pages are for **employees**, Operate pages for **operators**, Configure pages for
the **platform team**. On Understand pages, `{for=user}` and `{for=operator}` headings decide,
and unmarked sections are for **everyone**.

Claims are plain text: no citations, labels, link targets or emphasis. Table rows join their
non-empty cells with ` · `. A claim longer than 240 characters is cut with `…`.

On the pdi2 documentation (104 pages, 916 evidence items), every piece of evidence finds at
least one claim.

## 3. The gate

SN-MNT-014 keeps its severity (warn) and gains:

- the field filter: editing a business rule's `when` no longer flags a page that cites only its
  `script`;
- the first claim, quoted, with the count of the others.

SN-MNT-015 quotes the first claim too.

## 4. Tried

On a scratch clone of the pdi2 documentation workspace: setting Create Incident's
`no_attachment_v2` to true in the mirror (as a pull would) made `docs impact` name the one
employee sentence that tells people to attach screenshots. It takes about 30 s on that
workspace, most of it reading the mirror for the stale check, as `docs check` does.

## 5. What's new (slice 2, built 2026-10-18)

The product owner chose one file per release, and a warning when a note is missing.

`documentation/changes/<release>.md`:

```markdown
---
title: October 2026
date: 2026-10-18
notes:
  - for: employees
    note: You can no longer attach files when you report an incident.
    see: [incident/report]
  - for: it
    note: Create Incident hides attachments (no_attachment_v2).
    see: [incident/configure/report]
---
An optional introduction, in Markdown.
```

| Part | Behaviour |
|---|---|
| Format | `title`, `date` (YYYY-MM-DD) and `notes`; each note `for: employees` or `for: it`, `note`, and `see:` references as in pages (spec 010b). A missing field is a source error |
| `docs check` | `unknown-release-page` (error): a `see:` reference that leads to no page |
| Site | `employees/whats-new.html`, the notes for employees; `it/whats-new.html`, every note, the employees' marked "For employees". Newest release first, notes linked to their pages. In the menus: "What's new" under Start here (employee guide) and under Updates (IT guide). Without notes, no page and no link |
| One guide | Without an employee guide, only `it/whats-new.html`, with every note |
| SN-MNT-017 (warn) | A page whose evidence `validate` finds pinned to a new hash since `base` (the record changed, the page was checked again), when no note added since `base` links it. Base versions come from git (`GitDocumentationHistory`); only pages changed since `base` are read. A note counts as added when the same release file didn't hold it at `base` |
