# Q12 baseline: Smart Documents on a golden document (28 October 2026, 20:38-20:50)

**Test document:** [q12-golden-document.md](q12-golden-document.md), a 2-page Spanish SAP runbook
written for this test and attached to INC0025194 as `Runbook_SAP_SD-OPS-017_V1-801.pdf`. Every fact
and every planted personal detail is known, so the answers can be scored exactly.

**Entry point:** Document Viewer (`/now/document/viewer/<attachment>`), "Ask Otto", then "Answer
questions about the document".

## Questions

| # | Asked in | Answer (verbatim, shortened) | Verdict |
|---|---|---|---|
| D1 | Spanish | "pricing conditions transport imported without regenerating the access tables, KONV and A305 ... 80% of cases" | Correct, in English |
| D2 | Spanish | "a maximum of 20 minutes" | Correct, in English |
| D3 | Spanish | "Escalate to the on-call SAP Basis contact: Laura Martínez Ruiz ... email ... +34 611 222 333" | Correct, in English |
| D4 | Spanish | "No. PRD must never be restarted without an approved emergency change from the emergency CAB" | Correct, in English |
| D5 | Spanish | "Do not run /$SYNC between 9:00 and 14:00" | Correct, in English |
| D6 | English | "on 18/09/2026, and it was resolved in 25 minutes" | **Partial:** omits INC0023901, which the question asked for, and SAPWEB02 |
| D7 | Spanish | "must be approved by the Head of Sales" | Correct, in English |
| D8 | English | "if more than 50 users are affected, and use Very High priority" | Correct |
| D9 | Spanish | "every 30 minutes while the incident is ongoing" | Correct, in English |
| D10 | Spanish, not in the document | Nothing shown; internal output "N/A" | **Fail:** silent, instead of "the document doesn't say" |

Each answer took 30 to 40 seconds. The agent suggests a follow-up after each answer; one suggestion
("what to do if Sales asks before the 30-minute interval") is a question the document can't answer.

## Redaction

Two attempts ("Redact Document Content" option, and a typed request followed by the option): both
**failed**. The first showed the user an internal message: *"Please investigate why the document
preparation step for attachment e5e6... did not return a usable result. We need the document text,
anonymization mapping, and redaction codes..."*, exposing a system ID. The second: *"I couldn't
continue the redaction flow because the document preparation step did not return usable content."*
The preparation tool returned `output: null`. Redaction worked this morning on the MN.IT PDF, so the
likely cause is this generated PDF (built by hand, no embedded fonts or Unicode map). To retest with a
PDF exported from a word processor.

Typed text is ignored until an option is picked ("Please pick an option"), and a new chat loses the
document context.

## Score

| Criterion | Score | Why |
|---|---|---|
| Correct | 2 | 8 of 9 in-document answers fully right, 1 partial |
| Grounded | 1 | "Show sources" exists, but no page or section is cited |
| Insight | 1 | Literal answers, no "and also" (for example, D3 doesn't say level 3 comes next) |
| Actionable | 1 | Names the contact, but no action (call, notify, create a task) |
| Fit | 0 | Every answer in English to Spanish questions |
| Reliable | 0 | Silent on an out-of-scope question; redaction fails twice |
| **Total** | **5 of 12** | This morning's estimate was "about 10 of 12" |
