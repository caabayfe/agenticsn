# Build a capability with spec-driven development

Spec-driven development writes down **what and why** (a specification), then **how** (a plan),
then the steps (tasks), and only then the code, with a person approving before anything is built.
snagentic fits it because each stage has a tool that produces evidence instead of opinions, and
the last stage is enforced in code.

This guide shows the loop on the example from [build a capability](build-a-capability.md): *a P1
incident can't be resolved without a business service.* It works two ways:

- **With snagentic's own skills**, nothing extra to install (below).
- **With [GitHub spec-kit](https://github.com/github/spec-kit)**, which adds the spec, plan and
  tasks files and the slash commands for them (see [With spec-kit](#with-spec-kit)).

## The loop and where snagentic fits

| Stage | You write | snagentic provides | Gate |
|---|---|---|---|
| **1. Specify** | `specs/<nnn>-<name>/spec.md`: who needs what, and how you will know it works | `find`, `describe` to see what exists today | A person agrees the spec |
| **2. Plan** | `plan.md`: the option chosen, the records to create or change, the risks | `advise` (least custom option first), `describe` (what already runs), the skill `servicenow-design` | A person writes **Approved by** |
| **3. Tasks** | `tasks.md`: small steps, each checkable | the plan's record list | none |
| **4. Implement** | Fluent source on a branch | `adopt`, `validate` (platform rules), the skill `servicenow-build` | `validate` has no `block` |
| **5. Deliver** | the pull request | `plan-push`, `push`, the skill `servicenow-deliver` | the push gate: a plan id, passing validation, your confirmation, an unchanged remote base |
| **6. Verify** | `verification.md`: each requirement, covered or not | `pull` + `describe` to see it on the instance; `docs impact` for documentation | a person checks it in the browser |

Skills and instructions are guidance; only the gates in **bold** columns are enforced by code,
git or CI ([ADR-0011](../adr/0011-enforcement-layers.md)). **Approval is a person's act.** An agent
must not write "Approved by" for you.

## 1. Specify

`specs/001-p1-business-service/spec.md`:

```markdown
# P1 incidents need a business service

## Why
Reports by service need every major incident tied to a business service. Today 38% of resolved P1s
have none.

## Requirements
- R1  A P1 incident cannot move to Resolved while Business service is empty.
- R2  The user sees why, in the form, in the words of the platform.
- R3  Imports and integrations are held to the same rule.
- R4  P2 to P4 incidents are unaffected.

## Out of scope
Backfilling the 38% already resolved.

## Acceptance
- A1  Resolve a P1 with no service: refused, message shown.   (R1, R2)
- A2  Resolve a P1 with a service: succeeds.                  (R1)
- A3  Import a P1 as Resolved with no service: refused.       (R3)
- A4  Resolve a P2 with no service: succeeds.                 (R4)

## Open questions
- Q1  Which state counts as "resolved": state 6 only, or Closed too?   (decide: owner)
```

Give every requirement an ID: later stages cite it. An open question is a question, never a
guess; the owner answers it before the plan.

Read what exists first, so the spec describes this instance and not a generic one:

```sh
snagentic status && snagentic describe incident
snagentic find "business_service" --code --table incident
```

## 2. Plan

Ask the agent for the design (`/mcp__snagentic__design` in Claude Code, or "design this"). The
`servicenow-design` skill runs `describe` and `advise`, lists the options **least custom first**,
and stops for you. The result goes into `plan.md`:

```markdown
# Plan: P1 needs a business service

## Option chosen
The least custom option is a data policy that makes Business service mandatory when priority is 1
and state is Resolved: it also holds for imports (R3). It is rejected here only because R2 asks for
a specific message and a data policy shows the platform's standard "mandatory" one. A UI policy is
client-side only and fails R3. So: a before business rule, with the reason written down.

## Records
| Record | Class | Scope | Covers |
|---|---|---|---|
| P1 needs a business service to resolve | sys_script (before, update) | global | R1 R2 R3 R4 |
| P1BusinessServiceCheck | sys_script_include | global | R1 R4 |

## Interacts with
- Business rule "Incident State Active on Assignment" (order 100): runs before ours; no overlap.

## Rules that will apply
SN-PERF-001 (no update in a before rule), SN-MNT-001 (no hard-coded sys_ids).

## Approved by
(empty until a person writes their name and the date)
```

The plan stays unapproved until a person fills the last line. In a team, make that a pull request
review: the plan is a file in git and the approval is the merge.

## 3. Tasks

`tasks.md` splits the plan into steps small enough to check, each citing a requirement:

```markdown
- [ ] T1  Write P1BusinessServiceCheck (R1, R4)
- [ ] T2  Write the before business rule using it (R1, R2, R3)
- [ ] T3  `snagentic validate` is clean
- [ ] T4  `plan-push`, review the plan, `push` to dev (needs approval)
- [ ] T5  Check A1 to A4 on the instance
```

## 4. Implement

`/mcp__snagentic__build` or "build it". The `servicenow-build` skill follows the plan: adopt the
records you change, write the new ones as Fluent, and run `validate` until clean. The source is
exactly the one in [build a capability, step 4](build-a-capability.md#4-write-the-fluent-source).
Commit after each task, with its ID in the message.

## 5. Deliver

```sh
snagentic plan-push
snagentic push --instance dev --plan <planId> --confirm
```

`push` loads only the plan you reviewed, into the branch's update set batch. No plan id, a failing
gate, or a record changed on the instance since your base, and it refuses.

## 6. Verify

`verification.md` answers each requirement with evidence:

```markdown
| Req | Result | How |
|---|---|---|
| R1 | covered | A1, A2 tried in dev on 2026-11-14 |
| R3 | covered | A3: import set row refused |
| R4 | covered | A4 |
| R2 | partial | message shows in classic form; Service Operations Workspace shows a generic error (Q2) |
```

`partial` and `missing` are honest results: they become the next spec, not a quiet pass. Then
`pull dev` so the mirror holds the new records, `describe incident` to see them in execution order,
and `docs impact --base origin/main` if the process is documented
([generate documentation](generate-documentation.md)).

## With spec-kit

spec-kit writes the same files and gives you slash commands for each stage. Install it per its
README, then in the workspace:

```sh
specify init . --ai claude       # creates .specify/ and the /speckit.* commands
```

| spec-kit command | Stage | Add from snagentic |
|---|---|---|
| `/speckit.constitution` | the rules every spec follows | paste the constitution below |
| `/speckit.specify` | spec.md | have the agent run `status`, `describe`, `find` first |
| `/speckit.clarify` | answers to open questions | questions go to the owner, not the agent |
| `/speckit.plan` | plan.md | run the `servicenow-design` skill: `describe` + `advise` evidence in the plan |
| `/speckit.tasks` | tasks.md | cite requirement IDs |
| `/speckit.analyze` | coverage check across spec, plan and tasks | also run `validate` |
| `/speckit.implement` | the build | the `servicenow-build` skill; `validate` until clean |

A constitution for ServiceNow work:

```markdown
1. Least custom option first; justify any script (snagentic advise).
2. Never edit the mirror (instances/*/metadata) or a ledger; change Fluent source under source/.
3. Adopt an existing record before changing it; never copy it.
4. No plan is built until a person has written "Approved by" in plan.md.
5. Nothing is pushed except through plan-push, and only to a development instance.
6. Every requirement ends as covered, partial or missing, with evidence.
```

spec-kit's commands and file names change between releases: check `specify --help` for the ones your
version has. An experiment run with spec-kit and snagentic on an emergency-change spec reached
the same loop, and found that a review step before approval (separate reviewers for architecture,
security and performance, repeated until no blocker remains) caught design flaws that the first
plan missed. That reviewer set is **not shipped**: if you want it, write it as a spec-kit extension
in your own repository.

## How this repository works

snagentic's own development uses the same shape: a plan in `specs/<nnn>-<name>/plan.md` (goal,
where we start, decisions for the owner, steps, order, risks), a decision as an ADR when it changes
architecture, tests written first, and `bun run verify` as the gate. [AGENTS.md](../../AGENTS.md) has
the rules and [extending snagentic](extend-snagentic.md) the walkthrough.
