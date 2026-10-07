# 003. Agent interface: MCP tools, skills and instructions

- Status: Accepted (decisions D1–D5 taken on 2026-10-06)
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
  shared location, except for Claude Code, which reads only `.claude/skills/` (corrected
  2026-10-06: checked with Claude Code 2.1.285; Codex 0.160 reads `.agents/skills/`).
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
| `.agents/skills/<name>/SKILL.md` and `.claude/skills/<name>/SKILL.md` | Codex, Copilot, Cursor; Claude Code (which reads only `.claude/skills`) |
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
  *Recommendation: workflows; domain depth moves into `advise`.* **Decided (2026-10-06):
  workflow skills, with domain depth served by `advise`.**
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

## 10. Implementation notes: the knowledge index (step 1, 2026-10-06)

`find` and `describe` read a per-instance SQLite index (ADR-0005) at
`.snagentic/<name>/knowledge.sqlite`, rebuilt from the workspace's files at any time:

- **Records** (one row each): class, scope, name, the table it acts on, its phase and order,
  and the fields that describe it. Behavior classes are registered as data
  (`knowledge/domain/behavior.ts`); business-rule timing follows the platform's stored values
  (`before`, `after`, `before_display`, `async_always`, `async`, measured on the PDI).
- **Words**: a word-only full-text index of each record's files (YAML, scripts, child rows).
  "Used by" and code search ask it for candidate records in milliseconds, then `git grep`
  reads only those files for exact lines.
- **Refresh** before every call: what was committed since the last refresh, what is edited
  locally now, and what was edited locally last time; any changed file re-reads its record.
  Record files are scanned, not parsed (own YAML style, ADR-0015), checked against the parser
  with generated records.

Measured on the PDI (463,317 records):

| | Result |
|---|---|
| First build | 60 s, 927 MB peak, index 576 MB on disk |
| Refresh when nothing changed | about 0.9 s |
| `describe incident` (fields and 500+ behavior records in order) | about 1 s in all |
| `describe` of a script include, with who uses it | 1.05 s (was 11.3 s with full-mirror grep) |
| `find` by name | 4 ms in the index; `find --code` 0.9 s |

Not covered yet, and said so in every table description: flows and workflows triggered by a
table, and business rules on the global table. Follow-ups: lower the first build's peak memory;
order client-side behavior by type (onLoad, onChange, onSubmit) as well as order.

## 11. Implementation notes: `advise` (step 2, 2026-10-06)

The ServiceNow knowledge is a typed catalog in core (`packages/core/src/advice`), ported from
v1's six skills and rule set:

- **23 rules** (`SN-SEC/PERF/UPG/MNT/UX-nnn`, ids kept from v1): severity, why, remediation, and
  the scripts and classes they apply to. `validate` implements their checks next, with the same
  ids.
- **Guidance** (`SN-ADV-<area>-nnn`): design, server, client, security, integration and review
  practice, each tied to work phases and to the classes or intents it applies to.
- **Ten intents** (notify, field state, set a value, validate, approval, assignment,
  integration, schedule, access, actions), recognised from the request's words, each with its
  options least custom first (a test enforces the order) and the classes each option creates.

`advise` returns the ladder marked likely / possible / last resort with evidence from the
target tables (what already runs there), related records, the guidance and rules for the phase
and classes, and in design the design record. Live on the PDI: about 1.1 s per call.

## 12. Implementation notes: `validate` (step 2, 2026-10-06)

- **Rule pack.** `packages/rules-basic` holds v1's 21 script rules as ESLint rules (ADR-0006),
  each with triggering and passing samples; a test keeps it in step with the catalog. A
  boundary rule keeps packs pure: they import only themselves and the ESLint rule API.
- **Engine.** `core/governance` checks each changed record's script fields, each run as the
  kind the platform runs it (`advice/domain/script-fields.ts`: server, client or portal client;
  a client UI action's script is client code unless it guards a server branch). Only findings
  the change introduced are reported: a finding already in the base version, matched by rule,
  field and line text, is left out. Lines the credential rule flags are masked in every
  finding. New script records without a description get SN-MNT-006; a script that does not
  parse gets SN-MNT-007 (new, block). SN-UPG-002 is listed as not checked until there is an
  inventory of customized out-of-box records.
- **Interface.** `validate [paths...] --base <ref>`, an MCP tool; exit 1 on a block finding.
- **Calibration on the PDI** (17,026 out-of-box scripts in seven classes, 92 s): 5 parse
  failures, all real (a missing `+`, Rhino-only syntax, one-line scripts cut by a `//`
  comment). Portal client scripts are read as the function expressions the platform
  evaluates, and inline `eslint` comments in platform scripts are ignored; without these, 183
  working scripts failed to parse and ESLint's own messages leaked into findings.

Follow-ups: validating an update set's records (needs instance reads); the hit rates of
SN-MNT-001, SN-UPG-001 and SN-PERF-002 on out-of-box code are high and worth reviewing for
noise, although only new findings are ever reported.

## 13. Implementation notes: the agent pack (step 3, 2026-10-06)

- **Source.** `packages/agent-packs` holds the skills as typed data (the section 5.1 shape)
  and the instructions; it renders `SKILL.md` files (front matter quoted, stamped with the
  version) and MCP prompts. A boundary rule keeps it pure, like rule packs.
- **Four skills now**: design, build, review, explain. `servicenow-deliver` joins with
  `plan_push` and `push` (step 5), and the instructions name only tools that exist.
- **Contract test.** Every code span in the skills and instructions must be an MCP tool, an
  input or output field, or an enum value of one (walked from the zod schemas), or a skill
  name; every skill routes through at least one tool. Renaming a field breaks the build.
- **Install.** `agent install` writes `.agents/skills/*/SKILL.md` and the same files in
  `.claude/skills/` (Claude Code reads only that folder), the instructions between
  `<!-- snagentic:begin <version> -->` and `<!-- snagentic:end -->` in `AGENTS.md` (the
  team's text around it is kept), and `@AGENTS.md` in `CLAUDE.md`. Unchanged files are not
  rewritten. `doctor` warns, inside a workspace, when the block is missing or from another
  version.
- **MCP.** The server sends the instructions and offers `design`, `review` and `explain` as
  prompts taking the user's request.

Not yet: host hooks and permission rules (ADR-0011 layer 1), which need `check --changed`;
skill trigger evaluations and task runs (section 7, step 4).

## 14. Implementation notes: the evaluation harness (step 4, 2026-10-06)

`scripts/eval/` runs real agents (Claude Code headless first) on scripted scenarios and scores
what they did. Opt-in and local: it needs a mirrored workspace and costs money.

- **Workspace.** One APFS clone of a source workspace (default `~/snagentic/pdi`, about 70 s
  once), kept as a slot and reset with git before every run. Its instances point at
  `https://eval.invalid` (no keychain entry matches it, and password variables are removed),
  so nothing an agent does during an evaluation can reach an instance. Each variant installs
  the pack with the binary under test and commits it as the run's base.
- **Runs.** `claude -p` with `--strict-mcp-config` (only snagentic), `--setting-sources
  project` (none of the developer's own settings), an allow-list of tools, a budget and a
  time limit; multi-turn scenarios resume the session. Transcripts stay in `.eval-results/`
  (they quote instance code; git ignores them).
- **Scoring on behavior**, from the tool-call trace and the workspace diff: tools called,
  described before editing, no edits before approval, validated after the last edit, the end
  state passes `validate`, the least custom record classes, record paths cited, protected files
  and the instance's API left alone, and for trigger evaluations which skill was loaded.
- **Scenarios**: five tasks (explain twice, design, design then build, review) and six trigger
  phrasings (four must load a skill, two must not). **Variants** for experiment 1, how much the
  always-loaded instructions should say: A (shipped), B (plus a question-to-tool map and the
  CLI fallback), C (plus ServiceNow practice), and A and B without the MCP server.

Baseline (docs/reports/agent-eval-baseline-2026-10-06.md, 110 runs): the shipped instructions
(A) scored as well as or better than longer variants with and without MCP; a question-to-tool
map made agents skip the explain skill. Proposed: keep A. Findings so far: Claude Code reads skills only from `.claude/skills` (fixed in #18); the first
run showed `describe incident` returning 73,000 characters, over Claude Code's limit for an MCP
result, against principle 3.1.3 (fixed next, with the size-budget contract test).

## 15. Implementation notes: host hooks and permissions (2026-10-06)

ADR-0011 layers 1 and 2, for Claude Code first (other hosts: the same `check` and `validate`
commands, wired when their hook formats are added). `agent install` merges into the
workspace's `.claude/settings.json`, keeping the team's own settings and replacing only
entries whose command starts with `snagentic hook`:

| Hook | Runs | Effect |
|---|---|---|
| Before Edit/Write | `check --edited=false` on the file | protected file (local state, child rows, workspace configuration): the edit is refused with the reason |
| After Edit/Write | `check` on the file | block findings: fed back to the agent (exit 2); other findings: added as context |
| Stop | `validate` | block findings: the turn continues once with the findings; a second stop is let through so the agent can explain |

Permission rules deny direct HTTP (`curl`, `wget`, fetches to service-now.com), `--no-verify`,
and edits to protected files, and ask before `push`. Layer 4: `agent install` also installs `.git/hooks/pre-commit` running `validate` (left
alone when the team has its own hook). Hooks fail open: outside a workspace or
on their own failure they let the agent continue and say why, since enforcement is the push
gate and CI (ADR-0011). Checked with Claude Code 2.1.285: the permission rule refused an edit
to a child-row file before the hook ran; an `eval` edit got SN-SEC-001 back from the
after-edit hook; the stop hook kept the turn going once, then the agent explained.

Other hosts (2026-10-07). Copilot CLI 1.0.92 runs the hooks in `.claude/settings.json` (in a
trusted folder) with Claude-style payloads. Its edit tool is a patch, though: `tool_input` is
the patch text (`*** Update File: <path>`), not `{file_path}`, so the edit hooks parse patch
headers and also accept `path` and `filePath`. It ignores the permission rules, so a
`pre-shell` hook on `Bash` refuses the same commands. VS Code runs every hook for every tool,
so the edit hooks act only on edit tools. `check` no longer needs a single instance: protection
is per path, and records are validated per the instance in their path. Checked with Copilot
CLI 1.0.92 in a workspace with no instance: edits to `snagentic.yaml` and
`.claude/settings.json` were refused, `curl` was refused, and an ordinary file was created.
