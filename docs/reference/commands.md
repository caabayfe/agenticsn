# Command reference

Generated from the use-case registry; do not edit. Regenerate with `bun run docs`.

## Commands

### `init`

```
snagentic init [path] [options]
```

Create a snagentic workspace: a dedicated git repository with the standard layout for synced instance data. Run once per ServiceNow estate.

Changes the instance: no (writes only to the workspace). MCP tool: none.

Options:

- `--name <value>`: folder name for the default location

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `instance add`

```
snagentic instance add <name> [options]
```

Add a ServiceNow instance profile (URL, kind, user) to this workspace. No secrets.

Changes the instance: no (writes only to the workspace). MCP tool: none.

Options:

- `--url <value>`: instance name (dev12345) or https address
- `--username <value>`: integration user
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

Store the password for an instance in the OS keychain. Prompts without echo, or reads stdin.

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

Merge the latest pull of an instance into the workspace's current branch. Local work is never overwritten: conflicting changes get git conflict markers.

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

Check changed ServiceNow records against the platform rules (security, performance, upgradability, manageability, user experience) and report only what the change introduced, with rule id, file, line, why and remediation. By default checks every record edited since HEAD; give paths to check those, or base=origin/main to check a branch. Fix every block finding before delivering; never silence one.

Changes the instance: no. MCP tool: `validate`.

Options:

- `--base <value>`: commit, branch or tag to compare with; findings already there are not reported
- `--instance <value>`: default: the workspace's only instance

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `check`

```
snagentic check <paths...> [options]
```

Check files around an edit: whether they may be edited at all (local state, child rows and workspace configuration may not), and what the edit introduced (validate on those records). Fast; host hooks run it after every edit.

Changes the instance: no. MCP tool: none.

Options:

- `--no-edited`: false before an edit: only whether it is allowed
- `--instance <value>`: default: the workspace's only instance

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `plan-push`

```
snagentic plan-push [options]
```

Plan delivering the workspace's changes to the instance: the records and fields that would change, the update sets they go into, the gate (validate plus waivers), and records held in other open update sets. Writes nothing. Returns a planId for push when ready; show the plan to the user before pushing.

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

Deliver a reviewed plan to the development instance: writes the planned records into the update set 'snagentic: <label> [<scope>]' (one per scope), then checks each was captured. Only with the planId from plan_push and confirm=true, after the user approved the plan. Refuses if anything changed since the plan, on the instance or in the workspace.

Changes the instance: **yes, development instances only**. MCP tool: `push`.

Options:

- `--instance <value>`: the development instance
- `--plan <value>`: the planId from plan_push
- `--confirm`: true once the user approved the plan
- `--label <value>`: names the update sets (default: the git branch)
- `--allow-collisions`: 

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `agent install`

```
snagentic agent install [options]
```

Install the agent pack into the workspace: the workflow skills (.agents/skills, and .claude/skills for Claude Code), the instructions block in AGENTS.md and its import in CLAUDE.md, Claude Code hooks and permission rules in .claude/settings.json, and a git pre-commit hook that runs validate. Commit them so the whole team's agents work the same way. Run again after upgrading snagentic.

Changes the instance: no (writes only to the workspace). MCP tool: none.

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

### `doctor`

```
snagentic doctor [options]
```

Check that snagentic can work: git, OS keychain and search index on this machine, and, with --instance, credentials, connection, roles and timestamp handling of an instance.

Changes the instance: no. MCP tool: `doctor`.

Options:

- `--instance <value>`: also check this instance of the workspace

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
- `validate`: Check changed ServiceNow records against the platform rules (security, performance, upgradability, manageability, user experience) and report only what the change introduced, with rule id, file, line, why and remediation. By default checks every record edited since HEAD; give paths to check those, or base=origin/main to check a branch. Fix every block finding before delivering; never silence one.
  - `paths` (array, optional): record files to check (default: every record changed since base)
  - `base` (string, optional): commit, branch or tag to compare with; findings already there are not reported
  - `instance` (string, optional): default: the workspace's only instance
- `plan_push`: Plan delivering the workspace's changes to the instance: the records and fields that would change, the update sets they go into, the gate (validate plus waivers), and records held in other open update sets. Writes nothing. Returns a planId for push when ready; show the plan to the user before pushing.
  - `instance` (string, optional): default: the workspace's only instance
  - `label` (string, optional): names the update sets (default: the git branch)
  - `allowCollisions` (boolean, optional): accept records already held in someone else's open update set
- `push`: Deliver a reviewed plan to the development instance: writes the planned records into the update set 'snagentic: <label> [<scope>]' (one per scope), then checks each was captured. Only with the planId from plan_push and confirm=true, after the user approved the plan. Refuses if anything changed since the plan, on the instance or in the workspace. Destructive: hosts ask before running it.
  - `instance` (string, required): the development instance
  - `plan` (string, required): the planId from plan_push
  - `confirm` (boolean, optional): true once the user approved the plan
  - `label` (string, optional): names the update sets (default: the git branch)
  - `allowCollisions` (boolean, optional)
- `update_sets`: Read a ServiceNow instance's update sets. action=list: open and recently changed sets with update counts. show: one set's updates (needs id). collisions: records held by more than one open set. export: write a set as ServiceNow XML (needs id). Never changes the instance.
  - `instance` (string, required)
  - `action` (list | show | collisions | export, required)
  - `id` (string, optional): the update set's sys_id, for show and export
  - `days` (integer, optional): list: also sets changed in this many days
  - `output` (string, optional): export: file to write
- `plugins`: List installed and available plugins and store applications with their versions, from the inventory of the last pull (no call to the instance).
  - `instance` (string, required)
  - `text` (string, optional): only those whose id, scope or name contains this
  - `state` (active | inactive | all, optional): filter by state
- `plugin_activate`: Activate a plugin on a development instance with ServiceNow's CI/CD API, and follow it to the end. Cannot be undone. Never retried: if the outcome is unclear, it says what to check. Destructive: hosts ask before running it.
  - `instance` (string, required)
  - `id` (string, required): the plugin id, such as com.snc.incident_ai
  - `confirm` (boolean, optional): confirm that this changes the instance
- `doctor`: Check that snagentic can work: git, OS keychain and search index on this machine, and, with --instance, credentials, connection, roles and timestamp handling of an instance.
  - `instance` (string, optional): also check this instance of the workspace
