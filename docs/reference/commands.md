# Command reference

Generated from the use-case registry; do not edit. Regenerate with `bun run docs`.

## Commands

### `init`

```
snagentic init [path] [options]
```

Create a snagentic workspace: a dedicated git repository with the standard layout for synced instance data, and the Fluent project for global changes (source/global). Run once per ServiceNow estate.

Changes the instance: no (writes only to the workspace). MCP tool: none.

Options:

- `--name <value>`: folder name for the default location

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `instance add`

```
snagentic instance add <name> [options]
```

Add a ServiceNow instance profile (URL, kind, user, and an OAuth client id when the instance signs in an OAuth client) to this workspace. No secrets.

Changes the instance: no (writes only to the workspace). MCP tool: none.

Options:

- `--url <value>`: instance name (dev12345) or https address
- `--username <value>`: integration user; with --client-id, the client's OAuth Application User
- `--client-id <value>`: OAuth client id from the Application Registry, for the client-credentials grant
- `--kind <value>`: only development is written to (one of: development, test, production)
- `--acknowledge-read-only`: confirm that a test or production credential is read-only

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `instance list`

```
snagentic instance list [options]
```

List the instance profiles in this workspace.

Changes the instance: no. MCP tool: none.

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `instance remove`

```
snagentic instance remove <name> [options]
```

Remove an instance profile from this workspace. Synced data is not deleted.

Changes the instance: no (writes only to the workspace). MCP tool: none.

Options:

- `--forget-credentials`: also delete its stored credentials

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `auth login`

```
snagentic auth login <instance> [options]
```

Check the password (or OAuth client secret) with the instance, then store it in the OS keychain together with the profile's url and kind; it is used only while they match. Prompts without echo, or reads stdin.

Changes the instance: no (writes only to the workspace). MCP tool: none.

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `auth logout`

```
snagentic auth logout <instance> [options]
```

Delete the stored password for an instance from the OS keychain.

Changes the instance: no (writes only to the workspace). MCP tool: none.

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `pull`

```
snagentic pull <instance> [options]
```

Mirror an instance's metadata into the workspace's servicenow-remote/<name> branch. The first pull is complete and resumable; later pulls fetch only what changed. Then run integrate to bring it into the working branch.

Changes the instance: no (writes only to the workspace). MCP tool: `pull`.

Options:

- `--full`: pull everything again
- `--verify`: also compare the mirror with the instance by counts and repair differences

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `integrate`

```
snagentic integrate <instance> [options]
```

Merge the latest pull of an instance into the workspace's current branch. The mirror is read-only, so the instance's copy always wins there; a local edit to it is discarded and named. Reports adopted units the instance changed since they last agreed with source (drift): run adopt --refresh on them before planning.

Changes the instance: no (writes only to the workspace). MCP tool: none.

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `status`

```
snagentic status [instance] [options]
```

Show how fresh each instance's mirror is: last pull, interrupted pulls, pulls not yet integrated and local changes to synced files. Reads local state only; never calls the instance.

Changes the instance: no. MCP tool: `status`.

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `find`

```
snagentic find [text] [options]
```

Find where something lives in the mirrored instance: records by name (business rules, script includes, tables, fields, ACLs…) or, with code=true, by text inside scripts. Without text, lists records by class, table or scope. Reads the workspace only. Follow up with describe on a result's path.

Changes the instance: no. MCP tool: `find`.

Options:

- `--instance <value>`: default: the workspace's only instance
- `--code`: search inside scripts and long fields
- `--class <value>`: only records of this class, such as sys_script
- `--table <value>`: only behavior acting on this table
- `--scope <value>`: only records of this application scope
- `--limit <number>`: 

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `describe`

```
snagentic describe <target> [options]
```

Describe a table or a record of the mirrored instance. A table: its fields and everything that runs on it, in execution order (client scripts, UI policies, business rules before/after/async, notifications, ACLs), including what it inherits. A record (path or sys_id): its files and what refers to it. Reads the workspace only.

Changes the instance: no. MCP tool: `describe`.

Options:

- `--instance <value>`: default: the workspace's only instance
- `--inactive`: tables: also list inactive behavior
- `--phase <value>`: tables: list only this phase, in full (as next suggests when items were left out) (one of: client, action, query, display, before, after, async, notify, policy, access)

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `advise`

```
snagentic advise <intent> [options]
```

Advise on a ServiceNow change before or while making it. Give the request in the user's words and the tables involved. Returns the platform's options least custom first (each marked likely, possible or last resort, with what already exists on those tables), the ServiceNow guidance and rules that apply, and in the design phase a design record to fill. Reads the workspace only.

Changes the instance: no. MCP tool: `advise`.

Options:

- `--tables <values...>`: tables the change is about
- `--phase <value>`: design before editing, build while editing, review before delivering (one of: design, build, review)
- `--classes <values...>`: build and review: classes being changed, such as sys_script
- `--instance <value>`: default: the workspace's only instance

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `validate`

```
snagentic validate [paths...] [options]
```

Build the Fluent source the change touched and check what it adds or edits against the platform rules (security, performance, upgradability, manageability, user experience), reporting only what the change introduced, with rule id, file, line, why and remediation; edits to the read-only mirror are refused, and documentation pages citing a changed record, or out of date with the mirror, are named. By default checks every project changed since HEAD; give paths to check those projects, or base=origin/main to check a branch. Fix every block finding before delivering; never silence one.

Changes the instance: no. MCP tool: `validate`.

Options:

- `--base <value>`: commit, branch or tag to compare with; findings already there are not reported
- `--instance <value>`: default: the workspace's only instance
- `--staged`: check only what is staged for commit, as the index holds it (the pre-commit hook)

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `fluent-keys`

```
snagentic fluent-keys [paths...] [options]
```

Write src/fluent/generated/keys.ts for the Fluent projects under source/ whose build adds IDs: each new Now.ID gets its sys_id once, and keys.ts is committed with the source so every later build names the record the same (rule SN-MNT-010). The pre-commit hook runs it with --staged, which builds what is staged and stages keys.ts. Writes no other file and calls no instance.

Changes the instance: no (writes only to the workspace). MCP tool: none.

Options:

- `--staged`: build the projects as the index holds them and stage keys.ts (the pre-commit hook)

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `check`

```
snagentic check <paths...> [options]
```

Check whether files may be edited at all: the mirror of the instance, the ledgers, local state and workspace configuration may not. Fast; host hooks run it around every edit. What an edit to Fluent source introduces is validate's job.

Changes the instance: no. MCP tool: none.

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `adopt`

```
snagentic adopt <records...> [options]
```

Bring records from a development instance into the workspace's Fluent source, to edit them there (ADR-0031). The SDK converts each record; snagentic builds the result and checks it would rebuild what the instance holds before writing anything. Writes source/<scope>/ and its ledger; commit them. Name records by mirror path, table:sys_id or sys_id.

Changes the instance: **yes, development instances only**. MCP tool: `adopt`.

Options:

- `--instance <value>`: the development instance the records are read from
- `--refresh`: re-read adopted records changed on the instance, merged with local work as git merges

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `take-over`

```
snagentic take-over <records...> [options]
```

Take over out-of-box records the workspace's source declares whole, such as a form layout (ADR-0038 item 8). A record still as the platform shipped it (no customer update) is recorded in the ledger as this branch's, so the next plan loads the source over it. A record the client customized is refused and nothing is written. Name records table:sys_id.

Changes the instance: **yes, development instances only**. MCP tool: none.

Options:

- `--instance <value>`: the development instance holding the records

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `plan-push`

```
snagentic plan-push [options]
```

Plan delivering the workspace's Fluent source to the instance: each unit (one update) that would be created, loaded or deleted, compared with the instance's live copy, the update sets it goes into, the gate (validate plus waivers), and records held in other open update sets. Writes nothing. Returns a planId for push when ready; show the plan to the user before pushing.

Changes the instance: no. MCP tool: `plan_push`.

Options:

- `--instance <value>`: default: the workspace's only instance
- `--label <value>`: names the update sets (default: the git branch)
- `--allow-collisions`: accept records already held in someone else's open update set

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `push`

```
snagentic push [options]
```

Deliver a reviewed plan to the development instance: loads the planned units of the Fluent source (fluent/load) into the branch's update set batch, 'snagentic: <label>' (global changes) with a child 'snagentic: <label> [<scope>]' per other scope, checks each was captured and reads it back, then commits the ledgers. Pass pr to name the branch's pull request; otherwise its open one is linked when the GitHub CLI is signed in. draftPr opens a draft pull request first when there is none (the planned changes must be committed). Only with the planId from plan_push and confirm=true, after the user approved the plan. Refuses if anything changed since the plan, on the instance or in the workspace.

Changes the instance: **yes, development instances only**. MCP tool: `push`.

Options:

- `--instance <value>`: the development instance
- `--plan <value>`: the planId from plan_push
- `--confirm`: true once the user approved the plan
- `--label <value>`: names the update sets (default: the git branch)
- `--pr <value>`: the branch's pull request (default: found with the GitHub CLI)
- `--draft-pr`: open a draft pull request when the branch has none (needs committed changes)
- `--allow-collisions`: 

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `agent install`

```
snagentic agent install [options]
```

Install the agent pack into the workspace: the instructions block in AGENTS.md, a git pre-commit hook that runs validate, and for each host its skills, hooks and MCP server. GitHub Copilot (CLI, VS Code, cloud agent): .agents/skills, .github/hooks/snagentic.json, .mcp.json and .vscode/mcp.json. Claude Code: .claude/skills, CLAUDE.md, .claude/settings.json (hooks and permission rules) and .mcp.json. Commit them so the whole team's agents work the same way. Run again after upgrading snagentic.

Changes the instance: no (writes only to the workspace). MCP tool: none.

Options:

- `--host <value>`: the agent hosts to install for: all, claude or copilot (one of: all, claude, copilot)

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `update-sets list`

```
snagentic update-sets list <instance> [options]
```

List open update sets and those changed in the last days, with their update counts.

Changes the instance: no. MCP tool: none.

Options:

- `--days <number>`: also list sets changed in this many days

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `update-sets show`

```
snagentic update-sets show <instance> <id> [options]
```

Show one update set and its updates (type, action, target, author, date), without payloads.

Changes the instance: no. MCP tool: none.

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `update-sets collisions`

```
snagentic update-sets collisions <instance> [options]
```

Find records captured in more than one open update set (the last one committed wins). Exits with 1 when there are any, so CI can stop on them.

Changes the instance: no. MCP tool: none.

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `update-sets export`

```
snagentic update-sets export <instance> <id> [options]
```

Write an update set as ServiceNow XML, the same format as its "Export to XML", to import on another instance by hand or to archive. Reads only; nothing is created on the instance.

Changes the instance: no. MCP tool: none.

Options:

- `--output <value>`: file to write (default: <name>--<sys_id>.xml here)

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `plugins list`

```
snagentic plugins list <instance> [text] [options]
```

List installed and available plugins and store applications with their versions, from the inventory of the last pull (no call to the instance).

Changes the instance: no. MCP tool: `plugins`.

Options:

- `--state <value>`: filter by state (one of: active, inactive, all)

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `plugins activate`

```
snagentic plugins activate <instance> <id> [options]
```

Activate a plugin on a development instance with ServiceNow's CI/CD API, and follow it to the end. Cannot be undone. Never retried: if the outcome is unclear, it says what to check.

Changes the instance: **yes, development instances only**. MCP tool: `plugin_activate`.

Options:

- `--confirm`: confirm that this changes the instance

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `accelerator list`

```
snagentic accelerator list [options]
```

List the accelerator packs snagentic ships and those under the workspace's pack paths (snagentic.yaml accelerators.paths), with their modules and profiles (ADR-0026, ADR-0038).

Changes the instance: no. MCP tool: none.

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `accelerator check`

```
snagentic accelerator check [pack] [options]
```

Accelerator packs (ADR-0026, ADR-0038): without a pack, list them; with one, the modules a profile or a list installs and, with an instance, whether they can be installed there: each module's state (ready, needs-components, not-entitled, blocked) and the exact commands that fix it. Reads the mirror only, never the instance.

Changes the instance: no. MCP tool: `accelerator`.

Options:

- `--instance <value>`: check against this instance's mirrored components
- `--profile <value>`: install this profile's modules
- `--modules <values...>`: install these modules (with what they need)

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `accelerator add`

```
snagentic accelerator add <pack> <instance> [options]
```

Write an accelerator pack's modules into the workspace (ADR-0026, ADR-0031, ADR-0038): their Fluent source into the projects under source/, committed to the branch accelerator/<pack>/<instance> and merged into this one, and the out-of-box records they customize, to adopt and edit next. Changes nothing on the instance: validate, plan_push and push deliver it. Refuses until accelerator check says every module is ready.

Changes the instance: no (writes only to the workspace). MCP tool: none.

Options:

- `--profile <value>`: install this profile's modules
- `--modules <values...>`: install these modules (with what they need)

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `accelerator validate-data`

```
snagentic accelerator validate-data <pack> [options]
```

Check an accelerator pack's data templates (one CSV per entity in a directory, or the pack's demo set with --demo) before any load: mandatory fields, references that resolve, repeated keys (ADR-0026). Needs no instance, so it also checks data for test and production, which snagentic never loads. Refuses a directory git tracks: customer data is never committed.

Changes the instance: no. MCP tool: none.

Options:

- `--data <value>`: the directory with the templates, outside the workspace
- `--demo`: use the pack's fictional demo data
- `--profile <value>`: install this profile's modules
- `--modules <values...>`: install these modules (with what they need)

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `accelerator install`

```
snagentic accelerator install <pack> <instance> [options]
```

Install an accelerator pack's modules on a development instance (ADR-0038). Without --confirm it writes the install plan for the platform admin (components to activate, each module's update set and source, out-of-box records changed, data to load, risks) and changes nothing. With --confirm <plan id> it runs exactly that plan: components, then each module through validate, plan_push and push into its own update set, then the data, then commits the plan and a report. A run that stops resumes with the same command.

Changes the instance: **yes, development instances only**. MCP tool: none.

Options:

- `--profile <value>`: install this profile's modules
- `--modules <values...>`: install these modules (with what they need)
- `--data <value>`: the directory with the templates, outside the workspace
- `--demo`: use the pack's fictional demo data
- `--confirm <value>`: the plan id the admin approved

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `accelerator load`

```
snagentic accelerator load <pack> <instance> [options]
```

Load an accelerator pack's data templates (a directory, or the pack's demo set with --demo) into a development instance through the pack's import set tables (ADR-0026): every template is validated first and nothing loads until all pass; then each entity in order, one row per request, never retried, stopping after the first entity with rows the instance did not take. Reports counts and the business keys of failed rows, never other values. Test and production are loaded on the instance itself.

Changes the instance: **yes, development instances only**. MCP tool: none.

Options:

- `--data <value>`: the directory with the templates, outside the workspace
- `--demo`: use the pack's fictional demo data
- `--profile <value>`: install this profile's modules
- `--modules <values...>`: install these modules (with what they need)
- `--confirm`: confirm that this writes records

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `docs census`

```
snagentic docs census <process> [options]
```

List every application that reaches a documented process's tables, from the mirror: form and workspace actions (also those on the tables they extend, such as task), business rules, client scripts, UI policies, notifications, SLA definitions, and tables that refer to the process. Each application must be named by a feature in processes/<process>/features.yaml (documented, todo, out-of-scope or question); the ones no feature names are listed as undecided. Features only visible on screen (workspace buttons, side panels) are found by walking the form as each role. Reads only the mirror.

Changes the instance: no. MCP tool: none.

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `docs check`

```
snagentic docs check [options]
```

Check the workspace's documentation (documentation/) against the instance's mirror: evidence whose record changed or is gone, citations of unknown evidence, missing animations, and the sections: shared pages, end user and operator guides, configure pages. Exits 1 when a page is no longer true or a source has an error. Reads only the mirror.

Changes the instance: no. MCP tool: none.

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `docs impact`

```
snagentic docs impact [options]
```

What a change does to the workspace's documentation: each claim (sentence, list item or table row) whose evidence the change affects, with its page, heading and reader (employees, operators, platform team). Covers the Fluent source changed since base, evidence on a field only when that field changes, and evidence the instance changed since the page was verified. The text is Markdown, to post on a pull request. Read the JSON to fix the pages in the same change. Reads only the workspace and the mirror.

Changes the instance: no. MCP tool: none.

Options:

- `--base <value>`: commit, branch or tag to compare with, for example origin/main
- `--instance <value>`: default: the workspace's only instance

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `docs pin`

```
snagentic docs pin [page] [options]
```

Record the mirror's current hash in the evidence of the documentation pages (all, or a page by path, a process, or <process>/<topic>). Run it only after re-verifying the claims the evidence supports. Lists evidence whose record is gone: those claims must be rewritten.

Changes the instance: no (writes only to the workspace). MCP tool: none.

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `docs build`

```
snagentic docs build [options]
```

Build the documentation as a static site (HTML, CSS, self-contained animations) in .snagentic/site/, for any web server. Each page shows its evidence status against the mirror; a stale page is built and says so (docs check is the gate). --audio adds music and sound effects to the animations, --voice piper|system also narrates them, --video renders every animation as an MP4 on its page and names any it could not make. It makes the media site.yaml asks for (media: audio, voice, video), each flag replacing only its own setting (--voice none for no narration); recorded videos are reused until their animation changes.

Changes the instance: no (writes only to the workspace). MCP tool: none.

Options:

- `--audio`: give each animation an audio track: music and sound effects (needs ffmpeg)
- `--voice <value>`: narrate the steps with a voice: piper, system or none (implies --audio)
- `--video`: also render every animation as an MP4 on its page (needs ffmpeg and Chrome)

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `docs serve`

```
snagentic docs serve [options]
```

Build the documentation site and serve it on http://127.0.0.1:<port>/ for preview, until stopped with Ctrl-C. Local only; publishing is copying .snagentic/site/ to a web server.

Changes the instance: no (writes only to the workspace). MCP tool: none.

Options:

- `--audio`: give each animation an audio track: music and sound effects (needs ffmpeg)
- `--voice <value>`: narrate the steps with a voice: piper, system or none (implies --audio)
- `--video`: also render every animation as an MP4 on its page (needs ffmpeg and Chrome)
- `--port <number>`: the port (default 4173)

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `docs video`

```
snagentic docs video <animation> [options]
```

Record one documentation animation as an MP4 video (H.264, with music and sound effects, and narration with --voice piper|system), in .snagentic/videos/<animation>.mp4. Plays the animation in a headless Chrome in real time, so it takes as long as the animation.

Changes the instance: no (writes only to the workspace). MCP tool: none.

Options:

- `--voice <value>`: narrate with piper, system, or none
- `--fps <number>`: frames per second

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `doctor`

```
snagentic doctor [options]
```

Check that snagentic can work: git, OS keychain and search index on this machine, and, with --instance, credentials, connection, roles and timestamp handling of an instance.

Changes the instance: no. MCP tool: none.

Options:

- `--instance <value>`: also check this instance of the workspace

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `upgrade`

```
snagentic upgrade [options]
```

Replace this snagentic with the latest release (or --to <version>), after checking it against the release's SHA256SUMS and that it runs. Inside a workspace, also refreshes its agent pack. Lists the upgrade steps of the releases skipped over. Run by a person, never by an agent.

Changes the instance: no (writes only to the workspace). MCP tool: none.

Options:

- `--to <value>`: the version to install (default: the latest)

All commands also take `--format agent|json|text` and `--workspace <path>`.

## MCP tools

`snagentic mcp` serves these tools over stdio. Tools that change an instance are only offered
when the workspace has a development instance, and can only name those (ADR-0012).

- `pull`: Mirror an instance's metadata into the workspace's servicenow-remote/<name> branch. The first pull is complete and resumable; later pulls fetch only what changed. Then run integrate to bring it into the working branch.
  - `instance` (string, required)
  - `full` (boolean, optional): pull everything again
  - `verify` (boolean, optional): also compare the mirror with the instance by counts and repair differences
- `status`: Show how fresh each instance's mirror is: last pull, interrupted pulls, pulls not yet integrated and local changes to synced files. Reads local state only; never calls the instance.
  - `instance` (string, optional): one instance (default: all)
- `find`: Find where something lives in the mirrored instance: records by name (business rules, script includes, tables, fields, ACLs…) or, with code=true, by text inside scripts. Without text, lists records by class, table or scope. Reads the workspace only. Follow up with describe on a result's path.
  - `text` (string, optional): words of the name, or the text to look for in code; empty lists by class, table or scope
  - `instance` (string, optional): default: the workspace's only instance
  - `code` (boolean, optional): search inside scripts and long fields
  - `class` (string, optional): only records of this class, such as sys_script
  - `table` (string, optional): only behavior acting on this table
  - `scope` (string, optional): only records of this application scope
  - `limit` (integer, optional)
- `describe`: Describe a table or a record of the mirrored instance. A table: its fields and everything that runs on it, in execution order (client scripts, UI policies, business rules before/after/async, notifications, ACLs), including what it inherits. A record (path or sys_id): its files and what refers to it. Reads the workspace only.
  - `target` (string, required): a table name, a record path, or a sys_id
  - `instance` (string, optional): default: the workspace's only instance
  - `inactive` (boolean, optional): tables: also list inactive behavior
  - `phase` (client | action | query | display | before | after | async | notify | policy | access, optional): tables: list only this phase, in full (as next suggests when items were left out)
- `advise`: Advise on a ServiceNow change before or while making it. Give the request in the user's words and the tables involved. Returns the platform's options least custom first (each marked likely, possible or last resort, with what already exists on those tables), the ServiceNow guidance and rules that apply, and in the design phase a design record to fill. Reads the workspace only.
  - `intent` (string, required): the request, in the user's words
  - `tables` (array, optional): tables the change is about
  - `phase` (design | build | review, optional): design before editing, build while editing, review before delivering
  - `classes` (array, optional): build and review: classes being changed, such as sys_script
  - `instance` (string, optional): default: the workspace's only instance
- `validate`: Build the Fluent source the change touched and check what it adds or edits against the platform rules (security, performance, upgradability, manageability, user experience), reporting only what the change introduced, with rule id, file, line, why and remediation; edits to the read-only mirror are refused, and documentation pages citing a changed record, or out of date with the mirror, are named. By default checks every project changed since HEAD; give paths to check those projects, or base=origin/main to check a branch. Fix every block finding before delivering; never silence one.
  - `paths` (array, optional): source files whose projects to check (default: every project changed since base)
  - `base` (string, optional): commit, branch or tag to compare with; findings already there are not reported
  - `instance` (string, optional): default: the workspace's only instance
  - `staged` (boolean, optional): check only what is staged for commit, as the index holds it (the pre-commit hook)
- `adopt`: Bring records from a development instance into the workspace's Fluent source, to edit them there (ADR-0031). The SDK converts each record; snagentic builds the result and checks it would rebuild what the instance holds before writing anything. Writes source/<scope>/ and its ledger; commit them. Name records by mirror path, table:sys_id or sys_id.
  - `instance` (string, required): the development instance the records are read from
  - `records` (array, required): mirror paths, table:sys_id, or sys_ids
  - `refresh` (boolean, optional): re-read adopted records changed on the instance, merged with local work as git merges
- `plan_push`: Plan delivering the workspace's Fluent source to the instance: each unit (one update) that would be created, loaded or deleted, compared with the instance's live copy, the update sets it goes into, the gate (validate plus waivers), and records held in other open update sets. Writes nothing. Returns a planId for push when ready; show the plan to the user before pushing.
  - `instance` (string, optional): default: the workspace's only instance
  - `label` (string, optional): names the update sets (default: the git branch)
  - `allowCollisions` (boolean, optional): accept records already held in someone else's open update set
- `push`: Deliver a reviewed plan to the development instance: loads the planned units of the Fluent source (fluent/load) into the branch's update set batch, 'snagentic: <label>' (global changes) with a child 'snagentic: <label> [<scope>]' per other scope, checks each was captured and reads it back, then commits the ledgers. Pass pr to name the branch's pull request; otherwise its open one is linked when the GitHub CLI is signed in. draftPr opens a draft pull request first when there is none (the planned changes must be committed). Only with the planId from plan_push and confirm=true, after the user approved the plan. Refuses if anything changed since the plan, on the instance or in the workspace. Destructive: hosts ask before running it.
  - `instance` (string, required): the development instance
  - `plan` (string, required): the planId from plan_push
  - `confirm` (boolean, optional): true once the user approved the plan
  - `label` (string, optional): names the update sets (default: the git branch)
  - `pr` (string, optional): the branch's pull request (default: found with the GitHub CLI)
  - `draftPr` (boolean, optional): open a draft pull request when the branch has none (needs committed changes)
  - `allowCollisions` (boolean, optional)
- `update_sets`: Read a ServiceNow instance's update sets. action=list: open and recently changed sets with update counts. show: one set's updates (needs id). collisions: records held by more than one open set. export: write a set as ServiceNow XML (needs id). Never changes the instance.
  - `instance` (string, required)
  - `action` (list | show | collisions | export, required)
  - `id` (string, optional): the update set's sys_id, for show and export
  - `days` (integer, optional): list: also sets changed in this many days
  - `output` (string, optional): export: new file to write, relative to the workspace root
- `plugins`: List installed and available plugins and store applications with their versions, from the inventory of the last pull (no call to the instance).
  - `instance` (string, required)
  - `text` (string, optional): only those whose id, scope or name contains this
  - `state` (active | inactive | all, optional): filter by state
- `plugin_activate`: Activate a plugin on a development instance with ServiceNow's CI/CD API, and follow it to the end. Cannot be undone. Never retried: if the outcome is unclear, it says what to check. Destructive: hosts ask before running it.
  - `instance` (string, required)
  - `id` (string, required): the plugin id, such as com.snc.incident_ai
  - `confirm` (boolean, optional): confirm that this changes the instance
- `accelerator`: Accelerator packs (ADR-0026, ADR-0038): without a pack, list them; with one, the modules a profile or a list installs and, with an instance, whether they can be installed there: each module's state (ready, needs-components, not-entitled, blocked) and the exact commands that fix it. Reads the mirror only, never the instance.
  - `pack` (string, optional): the pack id; omit to list the packs
  - `instance` (string, optional): check against this instance's mirrored components
  - `profile` (string, optional): install this profile's modules
  - `modules` (array, optional): install these modules (with what they need)
