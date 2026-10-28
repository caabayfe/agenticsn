# P1-1 validation on everis2, 28 October 2026

**Task:** [P1-1](../../07-implementation-plan.md#p1-assist-16-nov-to-4-dec): incident, request,
change and problem summarization, resolution notes, KB generation, activity response, email
recommendation, sentiment.

**Verdict:** functionally **done**: every skill works end to end in Service Operations Workspace.
**Not all on OpenAI:** activity response and KB generation run on Claude Haiku 4.5 (Amazon
Bedrock and Anthropic). Changing that is a configuration decision (see [Open points](#open-points)).

## How it was tested

- Instance: everis2 (`everisspainsludemo2.service-now.com`), Service Operations Workspace, Chrome.
- User: `svc_fcaamano` (admin). Real analysts get the skills through `itil`.
- Test record: **INC0025193** `[P1-1 TEST] Outlook no sincroniza el correo desde esta mañana`,
  created for this test (caller Mandy Mcdonnell, Spanish description, comment and work note).
- Actions were real: comment posted, email sent, incident resolved, KB draft created.
- Outbound mail is off (`glide.email.smtp.active=false`): the emails are in `sys_email` as
  `send-ready` and never left the instance. The caller's address is `@example.com`.
- Provider evidence: `sys_generative_ai_log`, every call by `svc_fcaamano` from 07:38 to 07:49 (UTC).

## Results

| # | Skill | Record | UI result | Provider and model (log) | Result | Evidence |
|---|---|---|---|---|---|---|
| 1 | Incident summarization | INC0025193, INC0010018 | Accurate Issue / Key actions summary | Azure OpenAI `gpt_small` | Pass | [02](02-inc0025193-summary.jpg) |
| 2 | Sentiment | INC0025193 | "Negative" badge after the Spanish comment, automatic | Azure OpenAI `gpt-5.4-mini` | Pass | [02](02-inc0025193-summary.jpg) |
| 3 | Activity response | INC0025193, INC0010018 | "Acknowledge task" draft inserted and posted as an additional comment | **Amazon Bedrock `claude-haiku-4-5`** | Pass, not OpenAI | [03](03-inc0025193-activity-response-posted.jpg) |
| 4 | Email recommendation | INC0025193, INC0010018 | Draft inserted and sent; uses work notes facts | Azure OpenAI `gpt-5.4-mini` (plus a KB search query step) | Pass | [01](01-inc0010018-email-draft.jpg), [04](04-inc0025193-email-draft.jpg) |
| 5 | Resolution notes | INC0025193 | Resolve dialog pre-filled with Issue / Cause / Resolution steps; resolved | Azure OpenAI `gpt-5.4-mini` | Pass | [05](05-inc0025193-resolved-with-ai-notes.jpg) |
| 6 | KB generation | INC0025193 → KB0010015 | Draft article (Problem, Root cause, Steps to resolve, 206 words), source task linked | **Anthropic `claude-haiku-4-5`** (orchestrated by Azure OpenAI `gpt-5.4`) | Pass, not OpenAI | [06](06-kb0010015-generated-article.jpg) |
| 7 | Requested item summarization | RITM0010047 | Summary through the Otto panel (no summary card in the RITM view) | Azure OpenAI `gpt_small` | Pass | log only |
| 8 | Change summarization | CHG0000008 | Objective / Plan / Risk / Affected CIs | Azure OpenAI `gpt_small` | Pass, minor defect | [07](07-chg0000008-summary.jpg) |
| 9 | Problem summarization | PRB0000106 | Issue / Impacted CI / Root cause / Fix | Azure OpenAI `gpt_small` | Pass | [08](08-prb0000106-summary.jpg) |

Recording of the session: `p1-1-e2e-test-everis2-2026-10-28.gif` (50 frames, 11 MB), kept out
of git.

## Findings

1. **Two skills don't use OpenAI.** The default definitions are Amazon Bedrock for Activity Response
   Generation and Anthropic for Generate Knowledge Article, both set by `admin` in May and June.
   All other P1-1 skills use Azure OpenAI.
2. **Now LLM was replaced on 22 October.** Until 19 October, summary, sentiment and risk ran on
   Now LLM (`apriel-nowllm`); after the platform update they run on Azure OpenAI.
3. **The output is in English for Spanish records.** Summaries, the activity response, resolution
   notes and the KB article came back in English. Refine offers only Change tone, Elaborate and
   Shorten, with no language option. Covered by P1-3 (multilingual).
4. **There is no RITM summary card** in the SOW requested item view; it works only through the Otto panel.
5. **The change summary has an empty slot:** "The conflict status of this change request is ." The
   change has no CI, so conflict detection never ran.
6. **PRB0000007 has a legacy state `(1)`** and SOW shows "No overview container found". Demo data
   should use current problem states.
7. **Resolution notes added one step**, "Rebuild the corrupted Outlook profile", which nobody did;
   it was inferred from the work note. The analyst has to review it, as the dialog says.

## Open points

- Decide whether activity response and KB generation should move to Azure OpenAI (Now Assist
  Admin, default definition per skill) or stay on Claude. This is task P0-4.
- Run the same check as a user with only `itil`.
- Test data left on the instance: INC0025193 (resolved), KB0010015 (draft), 5 `send-ready`
  emails, a posted AI comment, and an unsaved email draft in the INC0010018 composer.
