# Command reference

Generated from the use-case registry; do not edit. Regenerate with `bun run docs`.

`snagentic --help` groups everyday commands by task. `snagentic --help-all` also lists
advanced and internal commands. Every command remains directly callable; use
`snagentic <command> --help` for required flags, defaults, effects and examples.

## Commands

### `init`

```
snagentic init [path] [options]
```

Create a workspace manually

Create a dedicated git workspace with a global Fluent project. For a complete first-time setup, use snagentic onboard instead. Installs bundled user skills and workspace agent integration.

**Effects:** Creates a workspace, source files, user skills and workspace agent configuration; does not call the instance.

MCP tool: none.
Help visibility: advanced.

Options:

- `--name <name>`: folder name for the default location (default: "workspace")

Examples:

- `snagentic init ./workspace`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `instance add`

```
snagentic instance add <name> [options]
```

Add an instance profile

Add an instance URL, kind and authentication identity to this workspace. Store the secret separately with snagentic auth login.

**Effects:** Writes the workspace profile; stores no secret and makes no instance changes.

MCP tool: none.

Required:

- `--url <url>`: instance name (dev12345) or https address
- `--username <username>`: integration user; with --client-id, the client's OAuth Application User

Options:

- `--client-id <client-id>`: OAuth client id from the Application Registry, for the client-credentials grant
- `--kind <kind>`: only development is written to (default: "development") (one of: development, test, production)
- `--acknowledge-read-only`: confirm that a test or production credential is read-only
- `--shared-mirror <shared-mirror>`: git remote that holds the team's mirror branch (team mode, e.g. origin): pulls continue from it

Examples:

- `snagentic instance add dev --url dev12345 --username your.user`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `instance list`

```
snagentic instance list [options]
```

List configured instances

List the instance profiles in the current workspace.

**Effects:** Reads workspace profiles; does not call the instance.

MCP tool: none.

Examples:

- `snagentic instance list`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `instance remove`

```
snagentic instance remove <name> [options]
```

Remove an instance profile

Remove a profile without deleting its mirrored data. Use --forget-credentials to also remove its stored credentials.

**Effects:** Removes the workspace profile and, optionally, stored credentials; does not change the instance.

MCP tool: none.

Options:

- `--forget-credentials`: also delete its stored credentials

Examples:

- `snagentic instance remove dev`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `auth login`

```
snagentic auth login <instance> [options]
```

Sign in to an instance

Check your password or OAuth client secret with the instance, then store it in the OS keychain. With --username, also remember this clone's identity. Prompts without echo, or reads stdin.

**Effects:** Reads the instance to verify credentials; writes the keychain and local identity.

MCP tool: none.

Options:

- `--username <username>`: sign in as this user, and keep it as this clone's identity

Examples:

- `snagentic auth login dev`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `auth logout`

```
snagentic auth logout <instance> [options]
```

Remove stored credentials

Remove the instance's stored credentials from the OS keychain.

**Effects:** Removes stored credentials; does not change the instance.

MCP tool: none.

Examples:

- `snagentic auth logout dev`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `pull`

```
snagentic pull <instance> [options]
```

Fetch metadata into the mirror branch

Fetch metadata into servicenow-remote/<instance>. The first pull is complete and resumable; later pulls are incremental. In team mode, reuse the shared mirror when fresh, or when stale and published by another user, unless --now. Run snagentic integrate afterwards.

**Effects:** Updates the local mirror and sync state; --publish also pushes the shared git mirror. Reads the instance when needed; never writes to it.

MCP tool: `pull`.

Options:

- `--full`: Recovery: pull all metadata again instead of incrementally
- `--verify`: Recovery: compare mirror counts with the instance and repair differences
- `--now`: Team sync: contact the instance even when a shared mirror would be reused
- `--publish`: Team sync: publish the mirror to its git remote (designated puller; fast-forward only)
- `--cost`: Diagnostics: measure server cost from transaction logs (development only)

Examples:

- `snagentic pull dev`
- `snagentic pull dev --verify`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `integrate`

```
snagentic integrate <instance> [options]
```

Bring the mirror into your working branch

Merge the latest mirror into the current branch, fetching a newer shared mirror when configured. The instance mirror wins over local mirror edits; discarded edits are reported. Refresh adopted records with drift before planning.

**Effects:** Updates the working branch and files; may fetch the shared git mirror. Does not call the instance.

MCP tool: none.

Examples:

- `snagentic integrate dev`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `status`

```
snagentic status [instance] [options]
```

Show mirror freshness and pending changes

Show pull freshness, interrupted work, pending integration, local changes and unfinished deliveries. Follow the suggested next command.

**Effects:** Reads local state; fetches the shared git mirror when configured. Does not call the instance.

MCP tool: `status`.

Examples:

- `snagentic status`
- `snagentic status dev`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `find`

```
snagentic find [text] [options]
```

Find records or search their code

Find records by name, or use --code to search script contents. Omit text to list records filtered by class, table or scope. Use snagentic describe on a result to investigate it.

**Effects:** Queries the local mirror and search index; does not call the instance.

MCP tool: `find`.

Options:

- `--instance <instance>`: default: the workspace's only instance
- `--code`: search inside scripts and long fields
- `--class <class>`: only records of this class, such as sys_script
- `--table <table>`: only behavior acting on this table
- `--scope <scope>`: only records of this application scope
- `--limit <limit>`: Maximum number of results (default: 20; range: 1–100)

Examples:

- `snagentic find assignment --class sys_script`
- `snagentic find --table incident`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `query table`

```
snagentic query table [options]
```

Read a bounded live table page

Read explicit fields with a selective literal filter. Use the returned cursor with the same query, fields and limit for another page. No mirror pull is required.

**Effects:** Reads live schema and records; masks secrets; writes no records. Adds one line to the local query log.

MCP tool: none.

Required:

- `--instance <instance>`: configured instance profile; test/production require live_queries enabled in instance.yaml and a verified read-only credential
- `--table <table>`: table name, validated against the live dictionary
- `--fields <fields...>`: explicit field names; at most two reference hops, no wildcard
- `--query <query>`: literal encoded query: each NQ branch needs sys_id/unique equality or IN, or explicit UTC sys_updated_on bounds within 31 days; no JavaScript/dynamic filters

Options:

- `--limit <limit>`: maximum returned rows (default: 10; range: 1–100)
- `--cursor <cursor>`: nextCursor from the same instance, query, fields and limit

Examples:

- `snagentic query table --instance dev --table incident --fields sys_id number --query sys_id=0123456789abcdef0123456789abcdef`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `query record`

```
snagentic query record [options]
```

Read one live record

Read explicit fields by table and sys_id. A missing or ACL-hidden record returns null.

**Effects:** Reads live schema and one record; writes no records. Adds one line to the local query log.

MCP tool: none.

Required:

- `--instance <instance>`: configured instance profile; test/production require live_queries enabled in instance.yaml and a verified read-only credential
- `--table <table>`: table name, validated against the live dictionary
- `--fields <fields...>`: explicit field names; at most two reference hops, no wildcard
- `--sys-id <sys-id>`: record sys_id

Examples:

- `snagentic query record --instance dev --table incident --sys-id 0123456789abcdef0123456789abcdef --fields number active`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `query aggregate`

```
snagentic query aggregate [options]
```

Count live records or groups

Count matches, optionally grouped by one non-sensitive field. Supports count only; refuses more than 100 groups.

**Effects:** Reads live schema and aggregate counts; writes no records. Adds one line to the local query log.

MCP tool: none.

Required:

- `--instance <instance>`: configured instance profile; test/production require live_queries enabled in instance.yaml and a verified read-only credential
- `--table <table>`: table name, validated against the live dictionary
- `--query <query>`: literal encoded query: each NQ branch needs sys_id/unique equality or IN, or explicit UTC sys_updated_on bounds within 31 days; no JavaScript/dynamic filters

Options:

- `--group-by <group-by>`: one direct non-sensitive grouping field

Examples:

- `snagentic query aggregate --instance dev --table incident --query sys_id=0123456789abcdef0123456789abcdef`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `query schema`

```
snagentic query schema [options]
```

Inspect live inherited table fields

Read the live dictionary through the parent chain. Pages fields instead of silently truncating at 1000. Does not list descendants.

**Effects:** Reads table definitions and dictionary fields; writes no records. Adds one line to the local query log.

MCP tool: none.

Required:

- `--instance <instance>`: configured instance profile; test/production require live_queries enabled in instance.yaml and a verified read-only credential
- `--table <table>`: table name, validated against the live dictionary

Examples:

- `snagentic query schema --instance dev --table incident`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `describe`

```
snagentic describe <target> [options]
```

Explain a table or record from the mirror

Describe a table's fields and supported behavior in execution order, including inheritance. A record path or sys_id shows its files and references. Table-triggered flows, workflows and global-table business rules are not covered.

**Effects:** Queries the local mirror and search index; does not call the instance.

MCP tool: `describe`.

Options:

- `--instance <instance>`: default: the workspace's only instance
- `--inactive`: tables: also list inactive behavior
- `--phase <phase>`: tables: list only this phase, in full (as next suggests when items were left out) (one of: client, action, query, display, before, after, async, notify, policy, access)

Examples:

- `snagentic describe incident`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `advise`

```
snagentic advise <intent> [options]
```

Suggest platform options and guidance

Match a request to a deterministic catalogue of platform options, least custom first, with facts from the mirror. This is design guidance, not an exhaustive architectural assessment. Choose design, build or review guidance with --phase.

**Effects:** Reads the local mirror and guidance catalogue; does not call the instance.

MCP tool: `advise`.

Options:

- `--tables <tables...>`: tables the change is about
- `--phase <phase>`: design before editing, build while editing, review before delivering (default: "design") (one of: design, build, review)
- `--classes <classes...>`: build and review: classes being changed, such as sys_script
- `--instance <instance>`: default: the workspace's only instance

Examples:

- `snagentic advise "Notify the manager on P1 incidents" --tables incident`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `validate`

```
snagentic validate [paths...] [options]
```

Check changed source against platform rules

Build changed Fluent projects and report findings introduced since --base, which defaults to HEAD. Pass paths to select projects, or --staged to check the index for pre-commit. Also reports affected or stale documentation. Fix blocking findings before delivery.

**Effects:** Builds in local scratch space; does not edit source or write to the instance.

MCP tool: `validate`.

Options:

- `--base <base>`: commit, branch or tag to compare with; findings already there are not reported (default: "HEAD")
- `--instance <instance>`: default: the workspace's only instance
- `--staged`: check only what is staged for commit, as the index holds it (the pre-commit hook)

Examples:

- `snagentic validate`
- `snagentic validate --base origin/main`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `fluent-keys`

```
snagentic fluent-keys [paths...] [options]
```

Generate stable Fluent record IDs

Write generated keys.ts files for projects whose build adds IDs. Commit these files with the source. The pre-commit hook uses --staged to build the index and stage the generated keys.

**Effects:** Writes generated keys.ts files; --staged also stages them. Does not call the instance.

MCP tool: none.
Help visibility: internal.

Options:

- `--staged`: build the projects as the index holds them and stage keys.ts (the pre-commit hook)

Examples:

- `snagentic fluent-keys`
- `snagentic fluent-keys --staged`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `check`

```
snagentic check <paths...> [options]
```

Check whether paths may be edited

Check edit boundaries for mirror files, ledgers, local state and workspace configuration. Host hooks run this around edits. Use snagentic validate to check the content of a change.

**Effects:** Checks local paths; does not change files or call the instance.

MCP tool: none.
Help visibility: internal.

Examples:

- `snagentic check source/global/src/fluent/index.now.ts`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `adopt`

```
snagentic adopt <records...> [options]
```

Bring records into editable Fluent source

Convert existing development-instance records into Fluent and verify that the build reproduces them before writing source. With --refresh, merge instance drift into already adopted records. Commit the source and ledger.

**Effects:** Reads the development instance; writes local Fluent source and its ledger. Does not write to the instance.

MCP tool: `adopt`.

Required:

- `--instance <instance>`: the development instance the records are read from

Options:

- `--refresh`: re-read adopted records changed on the instance, merged with local work as git merges

Examples:

- `snagentic adopt sys_script:0123456789abcdef0123456789abcdef --instance dev`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `take-over`

```
snagentic take-over <records...> [options]
```

Record ownership of whole out-of-box records

Record ownership of out-of-box records that source declares whole, such as layouts. Customer customizations are refused unless explicitly listed with --restated as restating the current instance copy. Review ownership before planning.

**Effects:** Reads the development instance and updates local ownership ledgers; does not write to the instance.

MCP tool: none.
Help visibility: advanced.

Required:

- `--instance <instance>`: the development instance holding the records

Options:

- `--restated <restated...>`: records among them whose source restates the instance's copy as it is now (a form section an accelerator adds a field to): taken over even when customized

Examples:

- `snagentic take-over sys_ui_section:0123456789abcdef0123456789abcdef --instance dev`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `plan-push`

```
snagentic plan-push [options]
```

Review delivery changes and collisions

Build the Fluent source, compare it with the live instance, run validation and check open update-set ownership. Review the changes and any SDK losses before approving the returned plan ID. Reuse --label and --allow-collisions values when pushing.

**Effects:** Builds locally and reads the instance; applies no instance changes.

MCP tool: `plan_push`.

Options:

- `--instance <instance>`: default: the workspace's only instance
- `--label <label>`: names the update sets (default: the git branch)
- `--allow-collisions`: Accept records held in other open update sets; review ownership before using this override
- `--recover-pending`: recover only pending receipts proven by original captures and live content; loads nothing and uses the original batch

Examples:

- `snagentic plan-push --instance dev`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `push`

```
snagentic push [options]
```

Deliver an approved plan to development

Recheck the workspace and instance against the plan from snagentic plan-push, then deliver the approved changes to development update sets. Stops if the plan no longer matches. Pass --confirm only after the user approved the plan. Reuse any planning overrides.

**Effects:** Writes to the development instance and commits delivery ledgers locally; --draft-pr may also create a pull request.

MCP tool: `push`.

Required:

- `--instance <instance>`: the development instance
- `--plan <plan>`: Plan ID returned by snagentic plan-push

Options:

- `--confirm`: Confirm that the user approved the plan
- `--label <label>`: Update-set label; reuse the value used for planning (default: git branch)
- `--pr <pr>`: the branch's pull request (default: found with the GitHub CLI)
- `--draft-pr`: open a draft pull request when the branch has none (needs committed changes)
- `--allow-collisions`: Accept ownership collisions; also use this override when planning
- `--recover-pending`: confirm a receipt-only recovery plan; rechecks original captures and live content without loading metadata

Examples:

- `snagentic push --instance dev --plan PLAN_ID --confirm`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `agent install`

```
snagentic agent install [options]
```

Install agent instructions, skills and hooks

Install bundled workflow skills at user level, plus instructions, hooks and MCP bindings in the current workspace. Use --scope workspace for cloud runners. Existing personal skills are preserved. Rerun after upgrading.

**Effects:** Writes user skills and workspace integration; does not call the instance.

MCP tool: none.

Options:

- `--host <host>`: the agent hosts to install for: all, claude, copilot or codex (default: "all") (one of: all, claude, copilot, codex)
- `--scope <scope>`: where skills are installed; instructions and MCP bindings stay in the workspace (default: "user") (one of: user, workspace)

Examples:

- `snagentic agent install`
- `snagentic agent install --host claude`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `update-sets list`

```
snagentic update-sets list <instance> [options]
```

List open and recently changed update sets

List open update sets and sets changed within --days, including update counts.

**Effects:** Reads the instance; makes no instance changes.

MCP tool: none.

Options:

- `--days <days>`: also list sets changed in this many days (default: 30; range: 0–9007199254740991)

Examples:

- `snagentic update-sets list dev`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `update-sets show`

```
snagentic update-sets show <instance> <id> [options]
```

Inspect an update set and its updates

Show update types, actions, targets, authors and dates without payloads.

**Effects:** Reads the instance; makes no instance changes.

MCP tool: none.

Examples:

- `snagentic update-sets show dev 0123456789abcdef0123456789abcdef`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `update-sets collisions`

```
snagentic update-sets collisions <instance> [options]
```

Find records held in multiple open update sets

Find overlapping ownership in open update sets. Exits with 1 when collisions exist, so CI can stop before promotion.

**Effects:** Reads the instance; makes no instance changes.

MCP tool: none.

Examples:

- `snagentic update-sets collisions dev`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `update-sets export`

```
snagentic update-sets export <instance> <id> [options]
```

Export an update set as XML

Export ServiceNow update-set XML for manual import or archival. The destination must not already exist.

**Effects:** Reads the instance and creates a local XML export; makes no instance changes.

MCP tool: none.

Options:

- `--output <output>`: file to write (default: .snagentic/<instance>/exports/<name>--<sys_id>.xml in the workspace, which git ignores)

Examples:

- `snagentic update-sets export dev 0123456789abcdef0123456789abcdef`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `onboard`

```
snagentic onboard <name> [options]
```

Connect an instance and prepare its workspace

Create a workspace, add the profile, sign in, check connectivity, then pull and integrate metadata. Rerun to continue after a stop. Wake a sleeping PDI before retrying. Installs bundled user skills and workspace agent integration.

**Effects:** Writes workspace files and credentials to the OS keychain; reads the instance without changing it.

MCP tool: none.

Required:

- `--url <url>`: instance name (dev12345) or https address
- `--username <username>`: the instance user; with --client-id, the OAuth Application User

Options:

- `--client-id <client-id>`: OAuth client id, for the client-credentials grant
- `--kind <kind>`: only development is written to (default: "development") (one of: development, test, production)
- `--acknowledge-read-only`: confirm that a test or production credential is read-only
- `--path <path>`: the workspace folder (default: the workspace you are in, else ~/snagentic/<name>)

Examples:

- `snagentic onboard dev --url dev12345 --username your.user`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `plugins list`

```
snagentic plugins list <instance> [text] [options]
```

List plugins and store applications

Inspect plugin and store-application inventory from the last pull. Filter by text or state.

**Effects:** Reads the mirrored inventory; does not call the instance.

MCP tool: `plugins`.

Options:

- `--state <state>`: filter by state (default: "all") (one of: active, inactive, all)

Examples:

- `snagentic plugins list dev`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `plugins activate`

```
snagentic plugins activate <instance> <id> [options]
```

Activate a development-instance plugin

Activate a plugin through the platform CI/CD API and follow its progress. This cannot be undone. An uncertain outcome is not retried automatically.

**Effects:** With --confirm, activates a plugin on the development instance.

MCP tool: `plugin_activate`.

Options:

- `--confirm`: confirm that this changes the instance

Examples:

- `snagentic plugins activate dev com.snc.incident --confirm`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `apps install`

```
snagentic apps install <instance> <scope> [options]
```

Install a store application on development

Install an available store application at the selected version, or the latest offered version. Never upgrades an existing installation. Optional --demo-data loads data that snagentic cannot remove.

**Effects:** With --confirm, installs the application and optional demo data on the development instance.

MCP tool: none.

Options:

- `--version <version>`: the version to install; the store's latest when absent
- `--demo-data`: also load the application's demo data, which snagentic cannot remove
- `--confirm`: confirm that this changes the instance

Examples:

- `snagentic apps install dev sn_ztsd --confirm`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `accelerator list`

```
snagentic accelerator list [options]
```

List packs, modules and profiles

Discover bundled accelerator packs and packs configured in the workspace. Lists their modules and installation profiles.

**Effects:** Reads local pack definitions; does not call the instance.

MCP tool: none.

Examples:

- `snagentic accelerator list`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `accelerator check`

```
snagentic accelerator check [pack] [options]
```

Check pack selection and prerequisites

Check a pack's selected modules and their prerequisites against the last pulled inventory. Reports missing components and next commands. Omit the pack to list available packs.

**Effects:** Reads pack definitions and the mirrored inventory; does not call the instance.

MCP tool: `accelerator`.

Options:

- `--instance <instance>`: check against this instance's mirrored components
- `--profile <profile>`: install this profile's modules
- `--modules <modules...>`: install these modules (with what they need)

Examples:

- `snagentic accelerator check itsm --instance dev`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `accelerator add`

```
snagentic accelerator add <pack> <instance> [options]
```

Prepare pack source for manual delivery

Add selected modules as Fluent source on an accelerator branch and merge it into the current branch. Resolve prerequisites first with snagentic accelerator check. Then validate, plan and push through the normal delivery workflow.

**Effects:** Writes source, commits an accelerator branch and merges it locally; does not write to the instance.

MCP tool: none.

Options:

- `--profile <profile>`: install this profile's modules
- `--modules <modules...>`: install these modules (with what they need)

Examples:

- `snagentic accelerator add itsm dev`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `accelerator validate-data`

```
snagentic accelerator validate-data <pack> [options]
```

Validate pack data before loading

Check mandatory fields, references and repeated keys before loading data. Choose --data for a customer directory outside git, or --demo for fictional pack data. Tracked customer data is refused.

**Effects:** Reads pack definitions and local data files; does not call the instance.

MCP tool: none.

Options:

- `--data <data>`: the directory with the templates, outside the workspace
- `--demo`: use the pack's fictional demo data
- `--domain <domain>`: the domain the data goes into, on an instance that separates data by domain
- `--profile <profile>`: install this profile's modules
- `--modules <modules...>`: install these modules (with what they need)

Examples:

- `snagentic accelerator validate-data itsm --demo`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `accelerator install`

```
snagentic accelerator install <pack> <instance> [options]
```

Plan and install a pack on development

Without --confirm, create a local installation plan for review. With --confirm PLAN_ID, execute that exact plan: prerequisites, validated module delivery and data loads. Rerun the same command to resume a stopped installation.

**Effects:** Writes a local plan; confirmed execution changes the development instance and commits an installation report.

MCP tool: none.

Options:

- `--profile <profile>`: install this profile's modules
- `--modules <modules...>`: install these modules (with what they need)
- `--data <data>`: the directory with the templates, outside the workspace
- `--demo`: use the pack's fictional demo data
- `--domain <domain>`: the domain the data goes into, on an instance that separates data by domain
- `--confirm <confirm>`: the plan id the admin approved

Examples:

- `snagentic accelerator install itsm dev`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `accelerator load`

```
snagentic accelerator load <pack> <instance> [options]
```

Load validated pack data on development

Validate all templates, then load them through the pack's import-set tables in dependency order. Choose --data or --demo. Stops after failed rows and never retries writes automatically.

**Effects:** With --confirm, loads data onto the development instance; reports failed business keys without customer values.

MCP tool: none.

Options:

- `--data <data>`: the directory with the templates, outside the workspace
- `--demo`: use the pack's fictional demo data
- `--domain <domain>`: the domain the data goes into, on an instance that separates data by domain
- `--profile <profile>`: install this profile's modules
- `--modules <modules...>`: install these modules (with what they need)
- `--confirm`: confirm that this writes records

Examples:

- `snagentic accelerator load itsm dev --demo --confirm`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `docs census`

```
snagentic docs census <process> [options]
```

List behavior affecting a documented process

Find applications and supported behavior reaching a process's tables in the mirror. Reports applications not yet covered by a feature decision. Features visible only on screen still need a role-based form walkthrough.

**Effects:** Reads documentation and the local mirror; does not call the instance.

MCP tool: none.

Examples:

- `snagentic docs census incident`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `docs check`

```
snagentic docs check [options]
```

Check documentation evidence and structure

Check evidence hashes, citations, missing animations and required guide sections. Exits with 1 when a claim is stale or a source has an error.

**Effects:** Reads documentation and the local mirror; does not change the instance.

MCP tool: none.

Examples:

- `snagentic docs check`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `docs questions`

```
snagentic docs questions [options]
```

Find recorded documentation questions

Search existing questions before asking a new one. Filter by record, words, process or status; open questions are shown by default.

**Effects:** Reads local question records; does not call the instance.

MCP tool: none.

Options:

- `--about <about>`: questions about this record: <table>/<sys_id>
- `--search <search>`: words that must all appear in the question
- `--process <process>`: a process id, or shared
- `--status <status>`: open (default), answered, dropped or all (one of: open, answered, dropped, all)

Examples:

- `snagentic docs questions`
- `snagentic docs questions --status all`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `docs impact`

```
snagentic docs impact [options]
```

Show documentation affected by a change

Find claims whose supporting evidence changed in Fluent source since --base or in the instance mirror. Includes page, heading and audience. Text output is Markdown suitable for a pull request.

**Effects:** Reads source, documentation and the local mirror; does not call the instance.

MCP tool: none.

Options:

- `--base <base>`: commit, branch or tag to compare with, for example origin/main (default: "HEAD")
- `--instance <instance>`: default: the workspace's only instance

Examples:

- `snagentic docs impact --base origin/main`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `docs pin`

```
snagentic docs pin [page] [options]
```

Update evidence hashes after reverification

Record the mirror's current hash for all documentation or selected pages. Reverify the claims first: pinning records a hash, it does not establish that the prose is correct. Missing records require rewriting their claims.

**Effects:** Updates local documentation evidence; does not call the instance.

MCP tool: none.

Examples:

- `snagentic docs pin`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `docs build`

```
snagentic docs build [options]
```

Build the verified documentation site

Build a static site in .snagentic/site/. Stale pages are labelled, not excluded; use snagentic docs check as the gate. Media flags override their own site.yaml settings; generated videos are cached until the animation changes.

**Effects:** Writes the local site and requested media; does not call the instance.

MCP tool: none.

Options:

- `--audio`: give each animation an audio track: music and sound effects (needs ffmpeg)
- `--voice <voice>`: narrate the steps with a voice: piper, system or none (implies --audio)
- `--video`: also render every animation as an MP4 on its page (needs ffmpeg and Chrome)

Examples:

- `snagentic docs build`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `docs serve`

```
snagentic docs serve [options]
```

Build and preview documentation locally

Build the documentation site and serve it on the loopback interface until Ctrl-C. Publish by copying .snagentic/site/ to your web server.

**Effects:** Writes the local site and starts a local preview server; does not call the instance.

MCP tool: none.

Options:

- `--audio`: give each animation an audio track: music and sound effects (needs ffmpeg)
- `--voice <voice>`: narrate the steps with a voice: piper, system or none (implies --audio)
- `--video`: also render every animation as an MP4 on its page (needs ffmpeg and Chrome)
- `--port <port>`: the port (default 4173) (range: 0–65535)

Examples:

- `snagentic docs serve`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `docs video`

```
snagentic docs video <animation> [options]
```

Record a documentation animation as MP4

Record an animation in headless Chrome with ffmpeg. Optional narration uses piper or the system voice. Recording runs in real time and takes as long as the animation.

**Effects:** Writes a local MP4 and generated media under .snagentic/; does not call the instance.

MCP tool: none.

Options:

- `--voice <voice>`: narrate with piper, system, or none (default: "none")
- `--fps <fps>`: frames per second (default: 30; range: 10–60)

Examples:

- `snagentic docs video overview`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `doctor`

```
snagentic doctor [options]
```

Diagnose workspace and connection problems

Check local prerequisites, git settings, search index, keychain, proxy and certificates. With --instance, also check credentials, connection, roles and timestamp handling.

**Effects:** Runs local checks and optional read-only instance checks; never writes to the instance.

MCP tool: none.

Options:

- `--instance <instance>`: also check this instance of the workspace

Examples:

- `snagentic doctor`
- `snagentic doctor --instance dev`

All commands also take `--format agent|json|text` and `--workspace <path>`.

### `upgrade`

```
snagentic upgrade [options]
```

Update snagentic and refresh its agent pack

Install the latest release or --to version after verifying checksums and available provenance. Also refresh the current workspace's agent pack. Run this yourself, not through an agent.

**Effects:** Downloads a release, replaces the binary and may update workspace agent files; does not call the instance.

MCP tool: none.

Options:

- `--to <to>`: the version to install (default: the latest)

Examples:

- `snagentic upgrade`

All commands also take `--format agent|json|text` and `--workspace <path>`.

## MCP tools

`snagentic mcp` serves these tools over stdio. Tools that change an instance are only offered
when the workspace has a development instance, and can only name those (ADR-0012).

- `pull`: Mirror an instance's metadata into the workspace's servicenow-remote/<name> branch. The first pull is complete and resumable; later pulls fetch only what changed. With a shared mirror, a pull continues from the newest of it and this clone's branch, and asks the instance nothing while that mirror is younger than its max age, or, unless --now, while it is older and another user publishes it (mode stale). Then run integrate to bring it into the working branch.
  - `instance` (string, required)
  - `full` (boolean, optional): pull everything again
  - `verify` (boolean, optional): also compare the mirror with the instance by counts and repair differences
  - `now` (boolean, optional): pull from the instance even when the shared mirror is younger than its max age, or stale and published by another user
  - `publish` (boolean, optional): push the mirror branch to the shared mirror after the pull (the designated puller; fast-forward only)
  - `cost` (boolean, optional): also measure the run's server cost from the instance's transaction log (development instances only)
- `status`: Show how fresh each instance's mirror is: last pull, interrupted pulls, pulls not yet integrated, local changes to synced files, and the team's shared mirror. Never calls the instance; with a shared mirror it runs git fetch. Follow its next.
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
  - `recoverPending` (boolean, optional): recover only pending receipts proven by original captures and live content; loads nothing and uses the original batch
- `push`: Deliver a reviewed plan to the development instance: loads the planned units of the Fluent source (fluent/load) into the branch's update set batch, 'snagentic: <label>' (global changes) with a child 'snagentic: <label> [<scope>]' per other scope, checks each was captured and reads it back, then commits the ledgers. Pass pr to name the branch's pull request; otherwise its open one is linked when the GitHub CLI is signed in. draftPr opens a draft pull request first when there is none (the planned changes must be committed). Only with the planId from plan_push and confirm=true, after the user approved the plan. Refuses if anything changed since the plan, on the instance or in the workspace. Destructive: hosts ask before running it.
  - `instance` (string, required): the development instance
  - `plan` (string, required): the planId from plan_push
  - `confirm` (boolean, optional): true once the user approved the plan
  - `label` (string, optional): names the update sets (default: the git branch)
  - `pr` (string, optional): the branch's pull request (default: found with the GitHub CLI)
  - `draftPr` (boolean, optional): open a draft pull request when the branch has none (needs committed changes)
  - `allowCollisions` (boolean, optional)
  - `recoverPending` (boolean, optional): confirm a receipt-only recovery plan; rechecks original captures and live content without loading metadata
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
