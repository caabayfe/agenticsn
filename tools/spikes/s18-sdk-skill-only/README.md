# Spike S18: how far a coding agent gets with ServiceNow's SDK plugin alone

- Date: 2026-10-16
- Question: the product vision (`specs/prodvision/design.md`, section 4.1) assumes ServiceNow's
  own SDK plugin now covers "build ServiceNow with your coding agent". How far does an agent get
  with **only** that plugin, no snagentic, on the scenarios snagentic was evaluated on?
- Verdict: **the plugin covers new scoped applications and targeted questions well. It can't
  deliver a change to an existing global table into an update set.** Its blind spots are the
  ones the mirror exists for: what already exists, what is inherited, and consistency between
  runs.

## Setup

| | |
|---|---|
| Agent | Claude Code 2.1.292, headless, model `sonnet` (as in the 2026-10-06 evaluation) |
| Plugin | `servicenow-sdk@claude-plugins-official` 1.2.0 (skill `now-sdk`), loaded with `--plugin-dir`; SDK 4.13.6 through `npx` |
| Isolation | One empty folder per run, outside the repository; `--setting-sources project` (none present), `--strict-mcp-config` with no server; no snagentic, no AGENTS.md |
| Instance | pdi2 (`dev389847`), credential passed only through the SDK's environment variables (as in S16), scrubbed from transcripts |
| Tools allowed | Files, Skill, and Bash for `npx`, `npm`, `node`, `git`, `ls`, `cat`, `find`, `grep`, `jq`, `mkdir` |
| Scenarios | The five prompts of `scripts/eval/scenarios.ts`; the build scenario gets a third turn, "deliver it so it is captured in an update set I can promote"; plus one new scoped application |
| Repetitions | 2 per scenario, 12 runs, **$4.15 in all** ($4.35 with the smoke run) |

Files: `run.ts` (runner), `scenarios.ts` (prompts and the review seed), `summarize.ts` (the table
below), `seed-review/` (the change to review). Transcripts stayed in the session's scratch folder.

Change from the evaluation: the review seed has no `eval()` line and no concatenated encoded
query. The session's safety classifier refused to write a script with a code-injection pattern,
so the security finding (SN-SEC-001) isn't tested here.

## Results

| Run | Turns | Cost $ | Minutes | Skill loaded | Live queries | Builds | Installs |
|---|---|---|---|---|---|---|---|
| explain-state-on-assignment 1, 2 | 1 | 0.09, 0.09 | 0.8, 0.6 | yes | 9, 7 | 0 | 0 |
| explain-assignment 1, 2 | 1 | 0.12, 0.13 | 0.7, 0.8 | yes | 8, 11 | 0 | 0 |
| design-notify-p1 1, 2 | 1 | 0.08, 0.09 | 0.4, 0.4 | yes | 6, 6 | 0 | 0 |
| review-risky-change 1, 2 | 1 | 0.05, 0.05 | 0.2, 0.2 | **no** | 0, 0 | 0 | 0 |
| build-mandatory-business-service 1, 2 | 3 | 1.57, 1.07 | 2.8, 2.7 | yes | 6, 11 | 3, 6 | 2, 2 |
| greenfield-equipment-loan 1, 2 | 1 | 0.60, 0.21 | 2.7, 0.7 | yes | 4, 5 | 2, 0 | 1, 0 |

A smoke run of explain-state-on-assignment before the series made 17 queries ($0.20).

### R1. Targeted questions: correct, cheap, and honest about coverage

- **State on assignment:** right both times. It named *Incident State Active on Assignment*,
  with its condition (`incident_state=1^assigned_toISNOTEMPTY`), order and effect.
- **What changes the assignment group:** good answers that **differ between runs**.
  - Run 2 found *Populate Assignment Group based on CI/SO*, a business rule inherited from `task`.
    Run 1 missed it: it searched only for rules on `incident`.
  - Both found the major-incident rule, *Abort changes on group*, the data lookup and the inactive
    assignment rules.
  - Neither checked the flows; both said so.
- Each answer took 6 to 17 live Table API requests. The SDK's `query` pages by offset
  (`nextOffset`), which snagentic's ADR-0016 forbids. On a PDI that's harmless; on a large
  production instance it is the load ASR-16 exists to avoid.

### R2. Design: misses what already exists

Both runs asked sensible questions: who the on-call manager is, which channel, which scope.
Both concluded that nothing existed, because the on-call schedule table (`cmn_rota`) is empty.
The mirror shows what they missed:

- the out-of-box notification *Incident Priority Raised*;
- the flow action *On-Call: Get current on-call member*.

Neither run offered to reuse them. Both proposed a new notification in a new scoped app. This is
the duplication `advise` is built to prevent: the least custom option starts from what is already
there.

### R3. Review: the model alone is enough for obvious problems

Both runs skipped the skill. They read the change from `git status` and found every planted
problem: the unscoped mass update, `setWorkflow(false)`, the hard-coded sys_id, and the query
inside the loop. Each took 12 seconds and cost $0.05. snagentic's rules don't add *detection*
for cases like these. What they add is *enforcement*: the gate in push, CI and the pre-commit
hook, which doesn't depend on someone asking for a review.

### R4. A change to a global table can't be delivered into an update set

The request was: *make Business service mandatory on the incident form for priority 1, then
deliver it so it's captured in an update set I can promote.*

- **Both runs wrote a correct UI policy** in Fluent and offered a data policy for imports and
  APIs. They asked before deploying.
- **Scoped project:** the build refuses a UI policy on `incident`, which is outside the app's
  scope.
- **Global project:** it builds, but `now-sdk install` fails: "unable to find the application file
  resource (must include a single sys_scope, sys_app, or sys_store_app entry)". The run found no
  project type besides `package`.
- **Run 1 stopped.** In turn 3 it looked for the SDK's credential in the environment, to write
  the records through the Table API. The tool permissions blocked it, and it asked the user. This
  is the risk ADR-0012 names: an agent with a shell reaches for the credential.
- **Run 2 worked around the build's scope check.** It wrote the policy with the generic `Record()`
  API inside a new scoped app, *Mandatory Business Service* (`x_2222332_bsmand`), and installed
  it. As a result:
  - pdi2 has a scoped application that owns form logic for a global table, which is an
    anti-pattern;
  - **no update set holds it**: `sys_update_xml` has no entry for the policy. The agent said so,
    and suggested publishing the app or re-saving the records by hand.

The cause is the route, not the model. The SDK's public `install` delivers application packages.
snagentic delivers global changes through the SDK's `configuration`-project load route into a
named update set (S11, S16, ADR-0028, spec 008). That is how it reached the batch update set in
1.7 and 1.8, and how 2.0 will deliver every change. The plugin user has no such route.

### R5. A new scoped application works

Run 1 built and installed *Equipment Loan* in 2.7 minutes for $0.60:

- a table with the four fields and the state choices;
- a business rule rejecting due dates in the past;
- create, write and delete ACLs for `itil`;
- an ATF test with four cases.

It handled the vendor prefix and the 18-character scope limit. It didn't run the ATF test, but
offered `now-sdk cicd test`.

Run 2 found run 1's app on the instance and stopped to ask instead of overwriting it, because
Fluent deletes could remove records. That's sound caution, but it means the two runs weren't
independent. Use a fresh scope name for each repetition when S18 is re-run.

## What this changes in the vision

1. **Confirmed:** ServiceNow's plugin owns greenfield scoped apps and quick questions. snagentic
   should not lead with them.
2. **Sharpened:** the differentiators are now proven on the scenarios, not only argued:
   - delivering changes to **existing and global** configuration **into update sets** (R4);
   - knowing **what already exists and is inherited**, so designs reuse instead of duplicate (R1,
     R2);
   - answers that are **consistent and complete** because they come from the whole mirror, not
     from what the agent thought to query (R1);
   - **no instance load** for understanding (R1);
   - **enforcement** that holds whoever writes the change (R3, R4 run 1).
3. **New:** the plugin and snagentic are complementary. A developer can use the plugin to
   scaffold and query, and snagentic to understand, check and deliver into update sets. After 2.0
   both use Fluent.

## Left on pdi2

| What | Created by | Notes | Rollback |
|---|---|---|---|
| App *Equipment Loan* `x_2222332_eqloan` (sys_app `33b94f66ce02435499382a75c87d2d2e`): table, business rule, 3 ACLs, ATF test | greenfield run 1 | Harmless | `sys_rollback_context` `b018e39c83445b10292aca75eeaad377` |
| App *Mandatory Business Service* `x_2222332_bsmand` (sys_app `d208519286da40ce909ceea8d882cc82`), with **an active UI policy on `incident`** (`2079b8dd23124e869266ffde31cf1bd0`, `priority=1` makes Business service mandatory) and its action | build run 2 | **Affects every P1 incident form on pdi2** | `sys_rollback_context` `e277279883445b10292aca75eeaad3db` |

## Limits

- Two runs per scenario: read differences as signals, not rates.
- One model (Sonnet). A stronger model might find the inherited rule and the reuse more often; it
  would still need to think of asking, and still pay the queries.
- The SDK-only agent had no `AGENTS.md` and no team conventions. A team could add some.
- Snagentic wasn't re-run on the same prompts today. The comparison is with the 2026-10-06
  baseline and with the mirror's answers.
