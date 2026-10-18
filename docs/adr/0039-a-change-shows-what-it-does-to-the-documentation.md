# 0039. A change shows what it does to the documentation, sentence by sentence

- Status: Accepted (product owner, 2026-10-18)
- Date: 2026-10-18
- Requirements: G3 (guardrails), G2 (explain an instance), ASR-01, ASR-09
- Amends: 0010 (adds the documentation impact report to scope)
- Builds on: 0036 (verified documentation), 0037 (employee and IT guides)
- Plan: `specs/010-verified-documentation/impact.md`

## Context

Every claim in the documentation rests on evidence: a mirror record, often one of its fields,
with the hash the author verified (ADR-0036). So snagentic knows which sentences depend on which
record. That link is what no other documentation tool has.

The gate only partly uses it today (spec 010 §4c):

- **SN-MNT-014** names the *page* that cites a record a change edits. It matches on the record,
  so a page citing one field of a business rule is flagged when any field of that rule changes.
- **SN-MNT-015** names evidence that no longer matches the mirror.

A reviewer gets a list of file names. They can't see what the change does to what people read,
or who reads it. The agent making the change gets the same list and has to re-read every page to
find the sentences.

## Decision

1. **Impact is computed per claim, not per page.** A claim is a block of a page (a paragraph, a
   list item, a table row) that cites a piece of evidence. Each claim keeps its heading and its
   reader:
   - **employees** for Use pages and Understand sections marked `{for=user}`;
   - **operators** for Operate pages and Understand sections marked `{for=operator}`;
   - **everyone** for unmarked Understand sections;
   - **the platform team** for Configure pages.
2. **Field evidence counts only when the field changes.** When a change edits a record, it
   reports the fields it changed. Evidence naming one field is affected only when that field is
   among them. Evidence on the whole record, and records the change adds or deletes, stay
   affected, as today.
3. **One report, from both kinds of change:**
   - a **source change**: Fluent units the change adds or edits since `base`, as `validate`
     finds them;
   - an **instance change**: evidence that no longer matches the mirror, because a pull brought
     a change made on the instance.
4. **`docs impact --base <ref>` prints it**, grouped by reader. Each item gives the page, the
   heading, the claim's text, the evidence, and what changed it. The text output is Markdown, so
   CI can post it as a pull request comment unchanged. It is read-only, a CLI command, and adds
   no MCP tool (ADR-0036 item 8). The agent reads it as JSON to fix the pages in the same
   change.
5. **The gate stays a warning.** SN-MNT-014 gains the precision of item 2 and quotes the first
   claim it affects. The change may be right and the page wrong, so it doesn't block.
   `docs check` remains the strict gate on stale evidence.
6. **Readers learn what changed from release notes** (product owner, 2026-10-18).
   - **One file per release:** `documentation/changes/<release>.md` gives a title, a date and
     notes. Each note is for employees or for IT, says what changed in the readers' words
     (written by the agent, never generated), and links the pages it concerns with `see:`
     references. An unknown reference fails `docs check`.
   - **What's new pages:** the employee guide lists the employee notes; the IT guide lists all
     notes, with the employee ones marked. Newest release first.
   - **A missing note is a warning:** SN-MNT-017 (warn) names a page re-pinned since `base` to a
     new hash, because the record it cites changed, when no note added since `base` links it.

## Consequences

- A reviewer can see that a change alters what employees read, with the sentence quoted, before
  merging. That turns documentation from something that goes stale into a gate.
- Fewer false warnings: editing a rule's condition no longer flags the page citing only its
  script.
- `docs impact` builds the changed Fluent projects, like `validate`, so it takes as long as
  `validate`.
- Claims are found by structure (blocks and citations), not by understanding text. A sentence
  that depends on a record but doesn't cite its evidence is invisible, as it is to `docs check`
  today. The skill's rule stays: every claim cites its evidence.

## Alternatives considered

- **Keep page-level findings and let the agent search.** Rejected: the reviewer is the reader of
  this report, not only the agent, and a page name says nothing about who is affected.
- **Diff the mirror at `base` against the current one** for the instance side. Rejected: the
  pinned hashes already say what each claim was verified against, which is the base that
  matters. A git-based mirror read would add a port for no extra precision.
- **Make SN-MNT-014 block.** Rejected for now: a change is often right and the page out of date.
  The pull request can still require `docs check` to pass.
- **A note per page, in its front matter.** Rejected by the product owner: a release file reads
  as one story, and a release often changes several pages at once.
- **Generate the new wording.** Rejected, as in ADR-0036: snagentic never writes the prose. The
  agent does, from the report.
