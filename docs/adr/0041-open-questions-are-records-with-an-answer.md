# 0041. Open questions are records, each with someone to ask and an answer

- Status: Accepted (product owner, 2026-10-20; piloted on on-call, pdi2); amended 2026-10-20
  (items 7–9: questions shared across processes)
- Date: 2026-10-20
- Requirements: G2 (explain an instance), ASR-09
- Amends: 0036 (pages and evidence), 0040 (`status: question` features)
- Relates to: 0037 (the IT guide's open-questions page), 0039 (impact and release notes)
- Plan: `specs/010-verified-documentation/questions.md` (with the on-call pilot)

## Context

A page says what the mirror can't establish in a section headed `{label=OPEN-QUESTION}`, and a
feature the census found but nobody could place is `status: question` with a free-text note
(ADR-0040). On pdi2, after nine processes, that is about 335 questions: some 294 numbered items
in 109 sections on 100 pages, and 41 feature notes. They can't be tracked:

- **No identity or state.** A question has no id, no status and no place for its answer; an answer
  can only be an edit to the page, and nothing shows what was asked, of whom, or when it closed.
- **Duplicates.** The same unknown is asked on every page it touches: on-call asks about a
  telephony provider on five pages and in one feature, and about escalation logging on three.
- **Different kinds, one list.** Decisions only the process owner can make ("should members ask
  for time off?"), screens nobody has opened yet, and values the mirror redacts or doesn't hold
  are written the same way, though each is closed by a different person in a different way.
- **No loop back.** An answer doesn't say which pages must change; a change on the instance
  doesn't say which questions it may have answered.

## Decision

1. **Questions are declared per process**, in `processes/<process>/questions.yaml`. Each has:
   - an id, `Q01`, `Q02`… within the process, never reused; another process cites it as
     `on-call/Q03`;
   - `ask`: the question, one sentence a person can answer;
   - `kind`: `decide` (the process owner's choice), `check` (look at a screen) or `hidden` (a
     value the mirror redacts or doesn't hold);
   - `who`: the role that answers, a role id from `process.yaml`, or `owner` (the process
     owner) or `platform` (the platform team);
   - `about`: the records it concerns, as evidence anchors (`<table>/<sys_id>[#field]`), pinned
     by `docs pin` like evidence;
   - `after`: questions it waits on (no screen can be checked before a shift exists);
   - `status`: `open`, `answered` with `answer`, `by` and `on`, or `dropped` with a reason.
2. **Pages and features cite questions instead of writing them.** A page cites `[Q03]` where the
   doubt is, as it cites `[E05]`. The build writes each page's *Open questions* section from its
   citations of open questions, so one question asked on five pages is one record.
   `features.yaml` gives a `question` feature `question: Q07` in place of its note. Employee
   pages leave citations out, as they leave out evidence (ADR-0037).
3. **An answer becomes evidence.** A page that applies an answer cites it as evidence of a new
   kind, `answered: Q03`, which shows who answered and when, as `seen` shows who looked.
4. **`docs check` keeps the loop closed**, for each process with a `questions.yaml`:
   - `answered-not-applied` (warning): a page still cites a question that has been answered;
   - `question-may-be-moot` (warning): a record a question is `about` changed in the mirror
     since it was pinned: the instance may have answered it;
   - `unasked-question` (warning): an open question that no page or feature cites;
   - an unknown id, a cycle in `after`, or a `who` that isn't a role is an error;
   - `unstructured-question` (warning): a `{label=OPEN-QUESTION}` section, still read and shown
     as today until the process is migrated.
5. **The IT guide's open-questions page becomes the tracker.** It lists questions by who answers
   them, then by kind, with counts open and answered, the pages each one holds back, and the
   questions waiting on it. Each process card shows its open questions next to its coverage.
6. **Answers are given in git.** The question file is the record; an answer is a commit or a
   pull request with its author and date. A worksheet for people who don't use git
   (`docs questions export`, `docs questions import`) is a later step, built only if owners need
   it.

### Amendment (2026-10-20): one question, however many processes ask it

Migrating pdi2 process by process left duplicates across processes: 20 records are the `about`
of questions in several processes, and 16 pairs from different processes are worded almost
alike (SMS through Notify is asked in four, alert simulation word for word in two).

7. **Questions about the instance live once, in `documentation/questions.yaml`**, cited as
   `[shared/Q01]`: a platform setting that several processes depend on (Notify, the inbound
   email address, AI Search). `who` may be any process's role. The tracker lists them first,
   "Across processes", with every page in every process each one holds back. A question that
   has the same shape but a different answer per process (do automation errors create change
   tasks, and incident tasks?) is one shared question naming the processes in its `ask`.
8. **`docs check` warns `possible-duplicate`** for two open questions in different files that
   are about the same record, or for any two whose wording is nearly the same. When they truly
   differ, `distinct: [incident/Q31]` on one of them silences the warning.
9. **`snagentic docs questions` lists the questions**, filtered by record (`--about`), by words
   (`--search`), by process or by status, so an author finds the existing question before
   writing a new one. The skill makes this the first step of asking.

## Consequences

- Each unknown is asked once, of one role, and closes once; the owner gets a short list of
  decisions instead of 100 pages to read.
- The pilot (on-call, 45 questions) gives 25 distinct questions: 16 decisions for the owner,
  3 hidden values and 6 screen checks, 2 of which wait on decisions. Screen checks and hidden
  values can mostly be closed by the next walk or a better mirror read, without the owner.
- Migration is work: each process's sections are rewritten as citations by an agent pass and
  reviewed. Until then the old sections still build, with a warning.
- Cross-process duplicates are found by the check and prevented by the lookup; a shared
  question is answered once for every process it holds back.
- The duplicate warning is a heuristic: shared records and similar wording find most
  duplicates, and an author can mark the pair it misjudges as `distinct`.
- An answer no page applies is visible, so documentation can't silently lag behind decisions.
- `question-may-be-moot` depends on the question naming the right records; a question about
  something absent from the mirror (a table with no records) can't be noticed this way.

## Alternatives considered

- **Keep the sections, add ids in the prose.** Rejected: duplicates and state stay in prose, and
  the check can't tell an answered question from an open one.
- **GitHub issues, one per question.** Rejected as the record: a second source that drifts from
  the pages, and not every client's documentation lives on GitHub. An export to issues can be
  added on top of the file if a client asks.
- **A shared tracker page with its own database.** Rejected for the same reason: answers outside
  git have no review and don't reach the pages. A worksheet that imports into git (item 6) gives
  owners the same ease.
