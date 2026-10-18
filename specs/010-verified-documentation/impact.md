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

## 5. Next: "What's new" (slice 2, to decide)

A page records dated change notes, written by the agent when an update changes what a reader
does:

```yaml
changes:
  - on: 2026-10-18
    note: Attachments can no longer be added when you report an incident.
```

The employee guide and the IT guide each get a What's new page listing their notes, newest
first, linked to the pages. A warning when a page's evidence was re-pinned to a new hash and no
note was added since `base` would keep it honest. Questions for the product owner:

1. Is the note per page (above), or one file per release under `documentation/changes/`?
2. Should the warning exist, or is the note the author's judgement?
