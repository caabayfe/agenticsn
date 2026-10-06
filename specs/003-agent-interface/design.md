# 003. Agent interface: MCP tools, skills and instructions

- Status: Draft for product-owner review
- Date: 2026-10-06
- Builds on: ADR-0002 (agent interface model), ADR-0011 (enforcement layers),
  ADR-0019 (the engine is served through MCP; the harness only triggers it)
- Target: v1.1 (with plan, push and governance), knowledge tools first

## 1. What we are designing

How a coding agent (Claude Code, GitHub Copilot, Codex, Cursor) works on a ServiceNow
workspace with snagentic, so that it behaves like a careful senior ServiceNow developer:
understands what exists before changing anything, chooses the least-custom option, follows
platform rules, validates its work, and delivers it through an update set.

Four layers carry this, each with one job:

| Layer | Job | Holds | Is it guidance or a guarantee? |
|---|---|---|---|
| **Instructions** (workspace `AGENTS.md` block, MCP server instructions) | Orientation and invariants, always in context | ~30 lines: what this workspace is, the golden rules, where to start | Guidance |
| **Skills** (Agent Skills standard) | *Workflows*: when to do what, which MCP query to make, what to do with the answer, when to stop and ask | Steps, decision points, output contracts. **No ServiceNow depth** | Guidance |
| **MCP tools** | *Facts and expertise*: the engine's computed knowledge of this instance and ServiceNow practice | Structured, bounded results with next steps | The answers are deterministic |
| **Hooks, push gate, CI** | Running the checks without the model choosing to | Calls into the same engine | Guarantee (ADR-0011) |

The guiding sentence (ADR-0019): **the smartness lives in the engine and is served through
MCP; skills only route the agent to the right query at the right moment.**

## 2. Facts this design rests on (checked 2026-10-06)

- Agent Skills (`SKILL.md`, an open standard since December 2025) are read by Claude Code,
  Codex, GitHub Copilot (VS Code, CLI, coding agent) and Cursor; `.agents/skills/` is the
  shared location every compatible tool scans.
- A skill is loaded when its **description** matches the task: the description is the
  trigger, the body is read only then. Short bodies matter.
- MCP **prompts** appear as slash commands in Claude Code's CLI (`/mcp__snagentic__<name>`);
  support elsewhere is uneven. They are a convenience, never the only path.
- MCP **server instructions** are injected into context by Claude Code; other hosts vary.
- Hosts increasingly load MCP tool schemas lazily (Claude Code lists deferred tools by name
  and loads schemas on demand). **Tool names and one-line descriptions decide whether a tool
  is found**; the 12-tool budget (ADR-0002) is about this discoverability as much as size.
- MCP sampling is deprecated (2026-07-28, SEP-2577): the server never asks the host's model to
  reason (ADR-0019). Elicitation (asking the user) remains available where hosts support it.
- v1 had six domain skills (architect, reviewer, server scripting, client UX, security,
  integrations) and five prompts. Their best part was the architect's decision ladder and
  design record, and the reviewer's "cite a rule id and a path, never rewrite silently".
  Their weak part was carrying ServiceNow rules as prose in each skill.

## 3. The MCP tools

### 3.1 Principles for every tool result

1. **Facts and guidance are separate fields.** `facts` are about this instance (read from the
   mirror); `guidance` is ServiceNow practice, each item with a stable rule or pattern id.
   The agent can tell "this is how your instance is" from "this is what we recommend".
2. **Point to files instead of copying them** (files first, ADR-0002). Results name workspace
   paths (and line ranges); the agent reads the script itself. Scripts are only inlined when
   asked (`include: ["scripts"]`).
3. **Bounded by default.** Every result has a size budget (default about 6,000 tokens), returns
   the most relevant items first, and says what was left out and how to get it (`more`).
4. **Freshness is always stated.** Every result carries `asOf` (the last pull) and a `stale`
   flag with the command to refresh when the mirror is older than a threshold.
5. **Next steps are explicit.** `next` lists the one to three tool calls that usually follow,
   with arguments filled in. Skills rely on this to stay short.
6. **No hidden instance traffic.** Knowledge tools read the mirror only; tools that talk to the
   instance say so in their description, and report their requests.
7. **Errors teach.** Every error has a stable code and a hint naming the next tool call.

### 3.2 The tool set (12, ADR-0002 budget)

Grouped by the question the agent is asking. Existing v1.0 tools keep their names.

| Question | Tool | v | Reads | Returns |
|---|---|---|---|---|
| Where does this live? | `find` | 1.1 | mirror | Records matching text, name, code or filters (class, scope, table), ranked, with paths |
| What is this, and what happens around it? | `describe` | 1.1 | mirror | A table: fields, inheritance and **all behavior in execution order** (business rules by when and order, client scripts, UI policies, ACLs, flows, notifications). A record: its fields, files, what it references and what references it |
| What should I do, and how? | `advise` | 1.1 | mirror + engine | For an intent and targets: the decision ladder evaluated for this case, the existing behavior a change would interact with, applicable rules and patterns, a design-record template |
| Is this right? | `validate` | 1.1 | workspace + engine | Findings (rule id, severity, path, line, why, remediation) for changed files, paths, or an update set |
| What would be pushed? | `plan_push` | 1.1 | workspace + instance | A plan id: the records to change, the target update set, collisions, the gate result |
| Deliver it | `push` | 1.1 | instance (writes) | Only with a plan id, a passing gate and an unchanged base (ADR-0006); development only |
| Is my mirror current? | `status` | 1.0 | local | Freshness, pending integration, local changes |
| Refresh it | `pull` | 1.0 | instance | Incremental pull, server cost |
| Update sets | `update_sets` | 1.0 | instance | list, show, collisions, export |
| Plugins | `plugins` | 1.0 | mirror | Installed and available plugins and store apps |
| Activate a plugin | `plugin_activate` | 1.0 | instance (writes) | Development only, confirmed |
| Is the machine ready? | `doctor` | 1.0 | local + instance | Environment and connection checks |

`references` and `impact` (ADR-0002) fold into `describe` (a record's "used by" and "uses"
sections) to stay within budget; `audit` (v1.2) and `troubleshoot` (production) will need
room. See open decision D1.

### 3.3 `advise`, the expert tool

`advise` is where the ServiceNow depth lives. It is deterministic: content is data and code
in the engine, selected by artifact types, tables and intent keywords; no model is involved.

```
advise({
  intent: "notify the on-call manager when a P1 incident is created",
  targets: ["incident"],            // tables or record paths
  phase: "design"                   // design | build | review
})
→ {
  asOf, stale,
  facts: {
    existing: [  // behavior the change would interact with, in execution order
      { kind: "business rule", when: "after insert", order: 100, name: "...", path: "..." },
      { kind: "notification", event: "incident.inserted", name: "...", path: "..." } ],
    similar: [ ... ]               // existing records that already do something close
  },
  ladder: [                        // least-custom first, evaluated for this case
    { option: "notification on incident.inserted with a condition", fit: "likely",
      why: "an incident.inserted event already fires; a notification needs no code" },
    { option: "flow on incident created", fit: "possible", why: "..." },
    { option: "business rule + event", fit: "last resort", why: "..." } ],
  guidance: [ { id: "SN-UPG-002", text: "...", applies: "if you edit a baseline record" }, ... ],
  designRecord: "Requirement: ... Option chosen: ... (template)",
  next: [ { tool: "describe", args: { target: "sysevent_email_action" } } ]
}
```

Its content is ported from v1's domain skills (server scripting, client UX, security,
integrations, upgrade safety) into a **pattern catalog**: one entry per pattern with an id,
when it applies (artifact types, tables, keywords, phase), the guidance, and good and bad
examples. The same ids appear in `validate` findings, so advice and checks speak one language.

### 3.4 Instance load and safety

`find`, `describe` and `advise` read only the mirror: they cost the instance nothing and work
offline. `plan_push` and `push` are the only new tools that call the instance; `push` and
`plugin_activate` exist only for development instances (ADR-0012), carry `destructiveHint`,
and confirm through elicitation where the host supports it.

## 4. Instructions (always in context)

One block, written to the workspace's `AGENTS.md` (read by every host; Claude Code reads it
through `CLAUDE.md` importing it), and the same text as the MCP server's instructions:

```markdown
# ServiceNow workspace (snagentic)

This repository mirrors ServiceNow instances: instances/<name>/metadata holds every
record as YAML, scripts as files beside it. Use snagentic's MCP tools (or the
`snagentic` CLI) for everything about the instance.

Golden rules
- Understand before changing: `describe` the tables and records involved, `advise`
  on the intent, and agree the design with the user before editing.
- Prefer configuration over code; never edit an out-of-box record you can extend.
- After editing, `validate` until no errors remain; never skip or silence a finding.
- Deliver only through `plan_push` and `push`; never call the instance's API yourself.
- Never edit `.snagentic/`, the servicenow-remote branches, or child-row files by hand.
- If `asOf` is old, run `pull` before relying on the mirror.

Skills: servicenow-design, servicenow-build, servicenow-review, servicenow-explain,
servicenow-deliver.
```

Kept under 30 lines: everything else is reached through a skill or a tool's `next`.

## 5. Skills: workflows that route to the right query

### 5.1 Shape of every skill

A skill is a short procedure (at most about 60 lines) with fixed sections:

```markdown
---
name: servicenow-design
description: <the trigger: the user intents it covers, in their words>
---
## When            the situations; when NOT to use it (and which skill instead)
## Steps           numbered; each names the tool call and its arguments
## Decide          the decision points, phrased on the tool's result fields
## Output          the contract handed to the user or the next skill
## Stop and ask    when to stop and ask the user instead of guessing
## Never           the two or three mistakes this workflow invites
```

Rules for writing them:

- **Name tools and fields, not knowledge.** "Call `advise` with phase=design; present
  `ladder` options marked likely or possible" instead of restating ServiceNow practice.
- **Every tool name and field a skill mentions is checked** against the registry's schemas in
  a test, so a renamed tool or field breaks the build, not the agent.
- **Descriptions are triggers.** Written in the user's words ("add a field", "notify",
  "why does this incident…"), tested with trigger evaluations (section 7).
- **One workflow per skill, not one domain per skill.** v1's domain skills (security, client
  UX…) become `advise` topics; the agent gets domain depth for the case at hand instead of a
  generic page.

### 5.2 The catalog

| Skill | Triggered by | Route |
|---|---|---|
| `servicenow-design` | "add / change / make … happen" before any edit | `status` (fresh?) → `describe` each target → `advise` (phase design) → design record → **user approves** |
| `servicenow-build` | an approved design | edit files following `advise` (phase build) → `validate` changed → fix → repeat until clean |
| `servicenow-review` | "review", "check", before delivery, or a PR | `validate` (changed, paths or update set) → explain each finding with its rule id and path → propose fixes, never silent rewrites |
| `servicenow-explain` | "why does…", "what happens when…", "where is…" | `find` → `describe` (behavior in order) → follow `used by` / `uses` → answer with paths and execution order |
| `servicenow-deliver` | "deploy", "push", "put it in an update set" | `update_sets` (collisions) → `plan_push` → show the plan → **user approves** → `push` → report |

`servicenow-design` and `servicenow-build` are separate so the approval point between them is
explicit. Orientation (freshness) is in the instructions and in every result's `stale`, not a
skill of its own.

### 5.3 Example: `servicenow-explain`, in full

```markdown
---
name: servicenow-explain
description: Explain how the ServiceNow instance behaves: why a field changes, what runs when a record is saved, where something is defined, what uses a script include. Use for questions, not changes.
---
## When
Questions about existing behavior. For a change, use servicenow-design.

## Steps
1. If you do not know where it lives: `find` with the user's words; pick the best match.
2. `describe` the table (or record). Read `behavior` in execution order: before rules,
   the database write, after rules, async work, notifications.
3. Read the scripts the result points to (paths and lines), not the whole folder.
4. If a script calls others, `describe` those records and follow `uses`.
5. Answer with the sequence of what runs, each step with its path.

## Decide
- `stale: true` → tell the user and offer `pull` before answering.
- More than one candidate in `find` → say which you chose and why.

## Output
A numbered sequence (when, what, path), then the direct answer.

## Stop and ask
If the behavior depends on data you cannot see (a property value, a user's roles), say
what would decide it instead of guessing.

## Never
Never answer from general ServiceNow knowledge when the mirror can show the actual records.
```

### 5.4 Same source, every host

Skills are written once in `packages/agent-packs/` and rendered:

| Host surface | What is generated |
|---|---|
| `.agents/skills/<name>/SKILL.md` | All hosts that read the standard (Claude Code, Codex, Copilot, Cursor) |
| MCP prompts `design`, `review`, `explain`, `deliver` | Claude Code slash commands (`/mcp__snagentic__design`), other hosts where supported |
| `AGENTS.md` block and MCP server instructions | Section 4 |
| Host hooks and permissions (where the host has them) | ADR-0011 layers 1 and 2: `check --changed` after edits, `validate` at the end of a turn |

`snagentic agent install` writes them into the workspace (versioned with the binary; `doctor`
warns when the installed pack is older than the binary). They live in the workspace, so the
whole team gets the same pack through git.

## 6. Worked example

User: "When a P1 incident is created, notify the on-call manager."

1. The `servicenow-design` skill triggers. `status` → fresh.
2. `describe incident` → behavior on insert: 9 business rules, 3 notifications, 1 flow,
   with paths; an `incident.inserted` event already fires.
3. `advise` (intent, targets incident, phase design) → ladder: a notification on
   `incident.inserted` with a priority condition is **likely**; a flow is possible; a
   business rule is a last resort. Guidance: SN-UPG-002 (do not edit the baseline
   notification), on-call lookup via the on-call schedule API, no hardcoded users.
4. The agent presents the design record; the user approves.
5. `servicenow-build`: creates the notification YAML; the hook runs `check --changed`;
   `validate` → one warning (missing description) → fixed → clean.
6. `servicenow-deliver`: `update_sets collisions` → none; `plan_push` → 1 record into
   "INC P1 on-call"; the user approves; `push` → done, with the update set link.

Every step the agent took was a tool result it could cite; no step relied on the model
remembering ServiceNow practice.

## 7. How we know it works

The agent interface is product, so it is tested like product:

1. **Contract tests (every commit).** Skills mention only existing tools and result fields;
   every tool result stays within its size budget on the PDI-sized fixtures; every `next`
   suggestion is a valid call.
2. **Trigger evaluations (per release).** For each skill, user phrasings that must load it and
   phrasings that must not; measured with real hosts in headless mode.
3. **Task evaluations (per release).** Scripted scenarios on a copy of the PDI mirror ("add a
   field and make it mandatory for P1", "why does assignment group change on save", "review
   this update set") run by real agents (Claude Code headless first). Scored on behavior, not
   prose: described before editing? asked for approval? validated until clean? cited paths?
   pushed only through a plan? Results are recorded per host and per release.
4. **Advice quality.** Each pattern in the catalog has examples that `validate` must flag (bad)
   and accept (good), so advice and checks cannot disagree.

## 8. Open decisions for the product owner

- **D1. Tool budget.** Twelve tools are fully used by v1.1 (section 3.2), leaving no room for
  `audit` (v1.2) and `troubleshoot`. Options: keep 12 and merge more (for example `plugins` and
  `plugin_activate`, or `doctor` into `status`); or raise the budget to about 16, since hosts now
  load schemas lazily and discoverability depends more on names and descriptions than count.
  *Recommendation: raise to 16 with a rule that every tool answers a distinct question.*
  **Decided (2026-10-06): the budget is raised as needed**, keeping the rule that every tool
  answers a distinct question; ADR-0002's budget is amended when the next tool is added.
- **D2. Skill granularity.** Workflow skills (this design) or v1's domain skills.
  *Recommendation: workflows; domain depth moves into `advise`.* **Open: explained to the
  product owner on 2026-10-06, awaiting a decision.**
- **D3. Where packs are installed.** In the workspace (shared through git, this design) or per
  user. *Recommendation: workspace.* **Decided: workspace.**
- **D4. Evaluations.** Build the task-evaluation harness in v1.1 alongside the tools.
  *Recommendation: yes; it is the only way to know a change to a skill or a tool result helped.*
  **Decided: yes, in v1.1.**
- **D5. Naming.** Skills named `servicenow-*` (the user's domain, matches how users ask) or
  `snagentic-*` (the product). *Recommendation: `servicenow-*`.* **Decided: `servicenow-*`.**

## 9. Delivery order

1. Knowledge tools on the mirror: `find`, `describe` (table behavior in execution order first),
   with the result principles of 3.1 and their contract tests.
2. The pattern catalog and `advise`, ported from v1's skills; `validate` sharing its ids.
3. Instructions, the five skills, MCP prompts and `agent install`, with contract tests.
4. The evaluation harness and a first baseline on the PDI.
5. `plan_push` and `push` with the gate, and `servicenow-deliver`.
