# Getting started

snagentic mirrors a ServiceNow instance's metadata into a git repository, so you and your
coding agent (Claude Code, GitHub Copilot, Codex…) can read, search and change it as files.
It syncs everything and keeps it fresh incrementally, explains and searches the mirror,
checks changes against platform rules, and pushes reviewed changes to development update
sets. It writes only to development instances; test and production are read-only.

New to snagentic? The [product overview](product/overview.md) explains what it is for.
Every command is described in the [command reference](reference/commands.md).

## 1. Install

macOS (Apple silicon) and Linux:

```sh
curl -fsSL https://github.com/caabayfe/agenticsn/releases/latest/download/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://github.com/caabayfe/agenticsn/releases/latest/download/install.ps1 | iex
```

The installers check the binary's SHA-256 sum before installing it. The binaries are not
signed yet, so macOS Gatekeeper and Windows SmartScreen may warn on first run. To build from
source instead: `bun install && bun run build` (writes `dist/snagentic`).

Then check your machine:

```sh
snagentic doctor
```

**Upgrading.** Once a day snagentic checks for a new release and, when there is one, prints
`snagentic <version> is available: run snagentic upgrade` after a command. Then:

```sh
cd <your workspace>       # optional: also refreshes its agent pack
snagentic upgrade         # or: snagentic upgrade --to 1.2.0, to go back
```

`upgrade` checks the new binary against the release's `SHA256SUMS` and that it runs before
replacing the old one, refreshes the workspace's agent pack (commit the files it lists), and
shows the steps of any release you skipped, such as logging in again. snagentic never updates
itself, and agents cannot run `upgrade`. The notice stays quiet in CI, in agent and JSON output,
and with `SNAGENTIC_NO_UPDATE_CHECK=1`.

## 2. Create a workspace

Synced data lives in its own git repository, never inside your application code:

```sh
snagentic init ~/snagentic/acme
cd ~/snagentic/acme
```

Every command works from any folder inside the workspace (or pass `--workspace <path>`).

## 3. Add an instance

```sh
snagentic instance add dev --url dev12345 --username svc_snagentic --kind development
snagentic auth login dev            # checks the password, stores it in the OS keychain
snagentic doctor --instance dev     # connection, roles, timestamps, load
```

Secrets never go into the workspace: the keychain, or environment variables in CI. The
password is stored together with the instance's URL and kind, and is used only while
`instance.yaml` still matches. If you change the URL or kind on purpose, run
`snagentic auth login dev` again. In CI, set all three variables:

```sh
SNAGENTIC_DEV_PASSWORD=...  SNAGENTIC_DEV_URL=dev12345  SNAGENTIC_DEV_KIND=development
```

Using an **OAuth client** instead of a password? Add `--client-id <id>` and set `--username`
to the client's OAuth Application User; `auth login` then asks for the client secret.

Details, OAuth prerequisites, a CI example and troubleshooting:
[credentials and instance trust](guides/credentials.md).

Test and production instances are **read-only by construction** (ADR-0012):

```sh
snagentic instance add prod --url acme --username svc_readonly --kind production --acknowledge-read-only
```

Their credential must hold the `snc_read_only` role; snagentic checks it before every
connection and refuses otherwise. Commands that change an instance do not exist for them.

## 4. Pull, then integrate

```sh
snagentic pull dev          # the first pull is complete and resumable
snagentic integrate dev     # merges it into your working branch
snagentic status            # freshness, pending integrations, local changes
```

The first pull of a large instance takes a while (the PDI: about 30 minutes for 463,000
records). It pages carefully and adapts to the instance's load; if interrupted, run it
again and it resumes.

After that, `pull` is incremental: when nothing changed it costs about 22 small requests
and a few seconds, and it reports the server time it used. Every few days, or when in
doubt, compare the mirror with the instance by counts and repair what differs:

```sh
snagentic pull dev --verify
```

Records live in a flat layout:
`instances/dev/metadata/<scope>/<class>/<name>--<sys_id>.yaml`, with scripts and other long
fields in files next to them (`….script.js`) and child rows (flow steps, form layouts) in
`….children.<table>.yaml`.

## 5. Update sets

Read live from the instance, so always current:

```sh
snagentic update-sets list dev                  # open and recently changed, with counts
snagentic update-sets show dev <sys_id>         # its updates, without payloads
snagentic update-sets collisions dev            # records held by two open sets (exit 1 if any)
snagentic update-sets export dev <sys_id>       # ServiceNow "Export to XML" format
```

## 6. Plugins

```sh
snagentic plugins list dev incident --state inactive     # from the pulled inventory
snagentic plugins activate dev com.snc.some_plugin --confirm
snagentic pull dev                                       # brings in what it installed
```

Activation uses ServiceNow's CI/CD API, works on development instances only, and is never
retried automatically: if its outcome is unclear, snagentic tells you what to check.

## 7. Deliver changes to a development instance

Edit records as files, check them, then plan and push:

```sh
snagentic validate                      # findings the change introduced; fix every block
snagentic plan-push                     # what would change, the gate, and collisions
snagentic push --instance dev --plan <planId> --confirm
snagentic pull --instance dev && snagentic integrate dev
```

`plan-push` compares the workspace with the instance as last pulled, and writes nothing. `push`
writes only that plan, and stops if any record changed on the instance since the pull. Only
development instances can be written.

Each branch, and so each pull request, gets its own **update set batch**: the update set
`snagentic: <branch>` holds the global changes, with a child `snagentic: <branch> [<scope>]`
for each other application scope. Pushing the branch again, from any machine or from CI, reuses
the open batch; preview and commit it on the target as one batch. Don't rename the batch on the
instance: its name is what links it to the branch.

With the [GitHub CLI](https://cli.github.com) installed and signed in (`gh auth login`, or
`GH_TOKEN` in CI), every push also links the branch's open pull request from the batch's
description. `--draft-pr` opens a draft pull request when the branch has none: commit your
changes first, since it pushes the branch and the pull request must show what was pushed.
Without `gh`, push works the same and says that no pull request is linked.

### Choices, forms and lists

A table's choices are mirrored beside its table record, in
`<scope>/sys_db_object/<table>--<sys_id>.children.sys_choice.yaml`. Add a row with a new
32-character sys_id and `name` set to the table, or change a row's fields. Push writes each
choice after its table, and stops if it changed on the instance since the pull. It never removes
one: set `inactive: 'true'` instead.

Lists, forms, form sections and related lists are **layouts**: a record and its rows, pushed
whole (ADR-0029, ADR-0030). The platform records a layout only as one composite update, so push
loads each changed layout, with all its rows, into the update set, in position order:

| Layout | Record | Rows |
|---|---|---|
| list | `<scope>/sys_ui_list/…` | `.children.sys_ui_list_element.yaml` (columns) |
| form section | `<scope>/sys_ui_section/…` | `.children.sys_ui_element.yaml` (fields, splits) |
| form | `<scope>/sys_ui_form/…` | `.children.sys_ui_form_section.yaml` (sections, in order) |
| related lists | `<scope>/sys_ui_related_list/…` | `.children.sys_ui_related_list_entry.yaml` |

- Removing a row removes it: a column, a field, a section from a form, a related list.
- A new layout is a new record file with its rows file. Its view is `Default view`, or the
  sys_id of a view in `global/sys_ui_view`.
- A layout in a domain other than global is that domain's own layout of the table. Put it
  under `domains/<domain>/` with `_meta.sys_domain` set; the plan names the domain.
- Sections load before forms. A new section also needs a row in its form's file to show on the
  form.
- A layout's table, view and domain (and a section's caption) identify it and cannot be
  changed.
- An existing section's header, title and roles cannot be changed from git: the platform records
  a section's fields, not these. Set them when you create the section, or on the instance.
- Related lists come back from the instance under new sys_ids after every push: the platform
  recreates them on each save. Pull and integrate follow that by themselves.
- Not pushed: related list layouts of a list (`parent` or `relationship` set) and personal
  layouts (`sys_user` set).

Records of a class the platform does not record in update sets, such as scheduled jobs, are
loaded the same way; the plan marks them `loaded`. Flow, workflow and variable-value child rows
stay read-only. Choices arrive on the first pull after upgrading to this version.

### A new application

A new feature belongs in its own scoped application. Create it from a file: add
`<scope>/sys_app/<name>--<sys_id>.yaml` with `name`, `scope` and `version`, and put the
application's records in the `<scope>` folder. The scope starts with `x_`, the instance's
company code and `_`; the code is the value of `glide.appcreator.company.code`, which pull
mirrors (`pull --full` once on a workspace pulled before this version). Push creates the
application before anything else in its scope, in the scope's update set of the batch, and
the next pull mirrors it (ADR-0025).

### Domains

On a domain-separated instance (managed service providers run one domain per customer),
`snagentic status` lists the instance's domains, and records outside global are mirrored under
`domains/<domain sys_id>/<scope>/<class>/`. A record's domain is `_meta.sys_domain`; push writes
it on every create (global when the file names none, never the session's domain), and changing
it moves the record, which the plan shows (ADR-0027). Build an application's logic in global;
use a customer's domain only for that customer's own changes.

### Flows

Flows, subflows and custom actions are written in Fluent, the ServiceNow SDK's TypeScript
language, and pushed like any other change (ADR-0028). snagentic ships the SDK's build (4.13.6)
inside the binary: no Node and no `node_modules`, and no telemetry. Put each application's flows
in a project under `source/<scope>/`:

```text
source/global/
  now.config.json                 { "scope": "global", "scopeId": "global", "type": "configuration" }
  package.json
  src/fluent/page-on-call.now.ts  Flow, Subflow and Action from @servicenow/sdk/automation
  src/fluent/generated/keys.ts    the sys_id of each Now.ID: commit it with the source
```

`validate` builds every project the change touches and reports build errors, IDs not yet in
`keys.ts`, records the build would delete, and an SDK version other than snagentic's. You never
write `keys.ts` by hand: when a commit adds a flow, the pre-commit hook (`snagentic agent
install`) builds what is staged, writes the new IDs to `keys.ts` and adds it to the commit.
Without the hook, run `snagentic fluent-keys source/<scope>` and commit `keys.ts` with the
source; `validate`, `plan-push` and CI block a project whose keys are missing.
`plan-push` lists each flow, subflow and action; `push` loads them into the batch, publishes them, and checks
the update set holds the published versions. A flow that already existed is inactive for a few
seconds while it is redelivered: records created meanwhile do not trigger it, which push reports.
Mirrored flow records stay read-only; to keep a change made in Flow Designer, bring it back into
the Fluent source.

### Accelerators

An accelerator pack is a ready-made set of records and data templates for one product area, in
capabilities you install wave by wave (ADR-0026). snagentic never activates plugins or loads data
on its own, and a pack's records go through `validate`, `plan-push` and `push` like your own:

```sh
snagentic accelerator list
snagentic accelerator check <pack> dev     # each capability: ready, needs-plugins, not-entitled or blocked
snagentic accelerator add <pack> dev       # writes the files, on the branch accelerator/<pack>/dev, merged here
snagentic validate && snagentic plan-push  # then push as usual
```

`check` reads the mirrored plugin list, so pull after activating a plugin; for a capability that
is not ready it prints the commands that make it ready. `add` refuses until every selected
capability is ready and the latest pull is integrated (`--waves` or `--capabilities` select
fewer). It copies the pack's new records and applies its patches to the mirrored out-of-box
records; it never writes a field pull does not mirror, such as a property that may hold a
secret. Adding the same version again changes nothing. A later version merges with your edits:
conflicts are left for you, and a record the new version no longer ships is kept and reported,
never deleted. The gate blocks a planned write of a capability that is no longer ready
(SN-MNT-012).

The pack's data (groups, locations, offerings) comes as CSV templates, one per entity. Fill
them in a directory outside the workspace: customer data is never committed, and snagentic
refuses a directory git tracks. After the push:

```sh
snagentic accelerator validate-data <pack> ~/customer-data              # mandatory fields, references, repeated keys
snagentic accelerator load <pack> dev ~/customer-data --confirm         # development instances only
```

`load` validates everything first, then posts one row per request through the pack's import set
tables, in dependency order, never retrying, and stops after the first entity with rows the
instance did not take. Loading again updates or leaves rows unchanged; it never duplicates them.
On test and production, load the same templates on the instance itself.

### ACLs

Writing ACLs (`sys_security_acl`, `sys_security_acl_role`) needs the elevated
`security_admin` role, which a REST session cannot use. Allow it once per instance:

```sh
snagentic auth login dev --allow-elevation
```

The instance must be development, use a password (not OAuth), and its user must hold
`security_admin`. From then on `push` writes the plan's other records as usual and, last, its
ACLs: it signs in to the instance in a headless Google Chrome or Microsoft Edge (install one of
them), elevates to `security_admin` only, writes the ACLs into the same update set, and signs
out (ADR-0024). The plan and the push result mark them `elevated: security_admin`. Single
sign-on login pages are not supported yet. `validate` checks ACLs too: a write, create or
delete ACL that nothing restricts, a deny ACL turned off or deleted, and admin overrides
turned off. In CI, set `SNAGENTIC_<NAME>_ALLOW_ELEVATION=true` with the other variables, on
an image that has Chrome.

Accept a finding you cannot fix with a reviewed waiver in `waivers.yaml`. Only committed waivers
apply, agents cannot edit the file, and the path must name an instance and a scope:

```yaml
waivers:
  - rule: SN-MNT-001
    path: instances/dev/metadata/global/sys_script_include/legacy-util--*.script.js
    reason: Known group, replaced in STRY0012345
    approver: lead@example.com
    expires: 2027-03-31
```

## 8. Use it from your coding agent

snagentic serves its tools over MCP: `find`, `describe`, `advise` and `validate` for
understanding and checking changes; `doctor`, `pull`, `status`, `update_sets`, `plugins`; and
(when the workspace has a development instance) `plugin_activate`.

Install the agent pack, once per workspace, and commit it so the whole team gets it:

```sh
snagentic agent install
git add AGENTS.md CLAUDE.md .agents .claude .github/hooks .mcp.json .vscode
git commit -m "Add the snagentic agent pack"
```

That is the whole setup. It adds short instructions to `AGENTS.md` (your own text there is
kept), five workflow skills in `.agents/skills` (and `.claude/skills`, where Claude Code
looks), and registers the MCP server for **Claude Code** (`.mcp.json`) and **GitHub Copilot in
VS Code** (`.vscode/mcp.json`), next to any servers you already have there. Claude Code asks
each user once to approve the project's server; VS Code shows it in the MCP server list.

The skills are `servicenow-design` (agree a design before editing), `servicenow-build` (edit,
then `validate` until clean), `servicenow-review`, `servicenow-explain` and
`servicenow-deliver` (plan, approval, push). Run `agent install` again after upgrading
snagentic; `doctor` warns when the pack is from another version. In Claude Code the workflows
are also slash commands: `/mcp__snagentic__design`, `/mcp__snagentic__review`,
`/mcp__snagentic__explain`, `/mcp__snagentic__deliver`.

### Choosing the agent host

By default `agent install` sets up every supported host (`--host all`). Pass `--host` to
install only what one host reads, for example on a machine where only GitHub Copilot is
allowed:

```sh
snagentic agent install --host copilot
git add AGENTS.md .agents .github/hooks .mcp.json .vscode
```

| Host | Files |
|---|---|
| `claude` (Claude Code) | `CLAUDE.md`, `.claude/skills`, `.claude/settings.json` (hooks and deny rules), `.mcp.json` |
| `copilot` (Copilot CLI, cloud agent, VS Code) | `.agents/skills`, `.github/hooks/snagentic.json`, `.mcp.json`, `.vscode/mcp.json` |

`AGENTS.md` and the git pre-commit hook are always installed. Copilot CLI runs the hooks in
`.github/hooks` only in folders you have trusted, so trust the workspace when it asks. Copilot
CLI also reads `.claude/settings.json`, so with `--host all` it runs each check twice; that is
harmless, but `--host copilot` avoids it. A hook that times out lets the action through, so
the hooks allow two minutes; the pre-commit hook and the push gate still apply.

If your agent starts the server elsewhere, set `SNAGENTIC_WORKSPACE` to the workspace path.
Agents can also run any command directly; `--format agent` gives compact output for them.
