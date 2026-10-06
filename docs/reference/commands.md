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
