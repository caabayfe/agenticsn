# Changelog

All notable changes to snagentic. Versions follow [semantic versioning](https://semver.org).

## [Unreleased]

### Changed

- `push` writes each branch, and so each pull request, into its own **update set batch**:
  `snagentic: <branch>` holds the global changes, with a child `snagentic: <branch> [<scope>]`
  per other application scope, so a pull request that spans scopes is promoted as one batch.
  `--pr <url>` links the pull request from the batch's description. An update set an earlier
  version opened as `snagentic: <branch> [global]` is not reused: complete or merge it.

## [1.2.0] - 2026-10-07

### ⚠️ Breaking: credentials are bound to their instance

Stored passwords from 1.1.0 and earlier are refused (`profile-not-trusted`), and CI needs two
more variables (ADR-0020). Before, editing `instance.yaml` could turn a production instance
into a development one, or send a stored password to another host. Now the password is stored
together with the instance's URL and kind, and used only while `instance.yaml` still matches.

To upgrade:

1. On each machine, run `snagentic auth login <name>` once per instance.
2. In CI, next to `SNAGENTIC_<NAME>_PASSWORD`, set `SNAGENTIC_<NAME>_URL` and
   `SNAGENTIC_<NAME>_KIND`.
3. Run `snagentic doctor --instance <name>` to check.

Guide: [credentials and instance trust](docs/guides/credentials.md).

### Added

- `agent install --host all|claude|copilot` installs only what the chosen host reads. GitHub
  Copilot (CLI and cloud agent) gets native hooks in `.github/hooks/snagentic.json`, with the
  same checks as Claude Code, and the `.agents/skills` workflows. Agents can't edit
  `.github/hooks/`.
- OAuth client credentials as an alternative to a password (ADR-0021):
  `instance add --client-id <id> --username <OAuth application user>`, then `auth login`
  asks for the client secret. Tokens stay in memory and are renewed before they expire. Guide:
  [credentials](docs/guides/credentials.md#with-an-oauth-client-instead-of-a-password).

### Security

- Role checks, the login check and push authorship now use the user the instance signed in,
  not the username written in `instance.yaml`. snagentic refuses to operate when they differ
  (`identity-mismatch`).

- `auth login` tries the password before storing it, and refuses a test or production
  credential without `snc_read_only` and a development profile whose credential has it.
  Agents may not run `snagentic auth` or set `SNAGENTIC_*` credential variables.
- Errors and `doctor` name all three CI variables when a credential is missing.
- Host hooks now work under Copilot CLI, which reads `.claude/settings.json`: they understand
  its patch edits and `path` arguments, so protected files are refused there too. On hosts
  that run every hook for every tool (VS Code), the edit hooks ignore reads.
- New `pre-shell` hook refuses `curl`, `wget`, calls to `service-now.com` and skipping git
  hooks (`--no-verify`, `commit -n`, `core.hooksPath`). It enforces the permission rules on
  hosts that ignore them. Run `snagentic agent install` again to add it.
- `check` reports protected files in workspaces with no instance or several. Before, the
  pre-edit hook failed open there. Each edited record is validated against its own instance.
- Protected paths are compared case-insensitively and with either separator, and now include
  `.claude/settings.json`, `.claude/settings.local.json` and `.github/hooks/`.
- `update-sets export` leaves out updates whose payload holds a secret: credential and
  certificate classes, secret fields, and secret-like or password-typed properties. It lists
  them as `withheld`, to move by hand. Before, payloads were written to disk unredacted.
- `update-sets export` never overwrites a file and never follows a link. Through MCP, the
  output must be a new, unprotected file inside the workspace. Before, an agent could write
  the export over any file the user could write.
- The Claude Code deny rules for protected files use `Edit(...)` only. Claude Code ignored the
  `Write(...)` rules. Existing `Write(...)` rules stay after an upgrade and are harmless.
- Only committed waivers apply. `plan-push` reads `waivers.yaml` from `HEAD` and says when the
  working copy differs. Agents can no longer edit `waivers.yaml`, and a waiver path must name
  an instance and a scope (`instances/<name>/metadata/<scope>/...`). Before, an agent could
  write a waiver for `**` and pass the push gate.
- Requests to an instance never follow a redirect, so the credential is never sent to another
  address.
- A username edited by hand in `instance.yaml` is checked again on every read, and a push label
  may not contain `^`, `[`, `]` or line breaks. Either could change an encoded query, for
  example to select another open update set.

## [1.1.0] - 2026-10-07

Agents can now understand an instance, design and build changes with platform guardrails, and
deliver them to development update sets. See the [product overview](docs/product/overview.md)
and [security and governance](docs/product/security-and-governance.md).

### Delivery

- `plan-push`: what pushing the workspace would change on the instance (fields per record,
  new records, update sets), gated by `validate` and reviewed waivers in `waivers.yaml`, with
  records held in other open update sets. Writes nothing; returns a plan id.
- `push`: writes a reviewed plan to a development instance, into the update set
  `snagentic: <branch> [<scope>]`, restoring the user's current update set afterwards; stops if a
  record changed on the instance since the last pull; verifies each write was captured.
- The `servicenow-deliver` skill and `deliver` prompt; `agent install` also writes skills to
  `.claude/skills`, where Claude Code looks.

### Guardrails in the agent's turn

- `agent install` adds Claude Code hooks and permission rules to `.claude/settings.json`
  (merged with the team's): protected files cannot be edited, each edit is checked (`check`),
  and the agent cannot end its turn with blocking findings without explaining; direct calls
  to the instance and `--no-verify` are denied, and `push` asks first.
- `check <paths...>`: the fast per-edit check the hooks run (protected files, then validate).
- `agent install` registers the MCP server for Claude Code (`.mcp.json`) and GitHub Copilot in
  VS Code (`.vscode/mcp.json`), keeping the team's other servers, so one command sets up the
  agent: no `claude mcp add` or hand-written config.
- `agent install` also installs a git pre-commit hook that runs `validate` (never replacing a
  hook the team already has), so a commit with blocking findings fails.

### Knowledge and governance

- `find` and `describe`: search the mirrored instance and explain a table's behavior in
  execution order, or a record and who uses it, from a local index (no instance requests).
- `advise`: for an intent and target tables, the options least custom first, with evidence
  from the instance, the applicable guidance and rules.
- `validate [paths...] --base <ref>`: checks changed records against 24 platform rules
  (security, performance, upgradability, manageability, user experience) and reports only
  what the change introduced; exits 1 on a blocking finding. Also an MCP tool.
- `agent install`: writes the agent pack into the workspace: instructions in `AGENTS.md`
  (imported by `CLAUDE.md`) and the workflow skills `servicenow-design`, `-build`, `-review`,
  `-explain` and `-deliver` in `.agents/skills`. The MCP server sends the same instructions and offers
  the workflows as prompts; `doctor` warns when the installed pack is from another version.

## [1.0.0] - 2026-10-06

The first release of the rebuild: sync all of an instance's metadata into git, keep it fresh
with almost no load on the instance, and act on update sets and plugins. See
[getting started](docs/getting-started.md) and the [command reference](docs/reference/commands.md).

### Sync

- `init` creates a workspace: a git repository with a standard layout, separate from your code.
- `instance add/list/remove`, `auth login/logout`: profiles in the workspace, secrets only in the
  OS keychain or environment variables.
- `doctor [--instance]`: environment, connection, roles, timestamps and load checks.
- `pull`: the first pull mirrors every `sys_metadata` class, child rows (flows, layouts,
  workflows) and the plugin and store-app inventory, resumably; later pulls are incremental
  (22 requests and a few seconds when nothing changed) and report their server cost from the
  instance's transaction log. `--verify` compares the mirror with the instance by counts and
  repairs it. Records installed by plugins and apps are picked up too.
- `integrate`: merges a pull into the working branch with git.
- `status`: freshness, interrupted pulls, pulls not yet integrated, local changes; no requests.

### Actions

- `update-sets list/show/collisions/export`: read live; `export` writes ServiceNow's "Export to
  XML" format (checked against ServiceNow's own and by importing it back); `collisions` exits 1
  when records are held by more than one open update set.
- `plugins list` from the pulled inventory; `plugins activate --confirm` through the CI/CD API,
  on development instances only, never retried on an ambiguous outcome.

### Agents

- `snagentic mcp` serves six tools: `doctor`, `pull`, `status`, `update_sets`, `plugins` and,
  when the workspace has a development instance, `plugin_activate`.
- Every command takes `--format agent|json|text` and returns stable exit codes.

### Safety

- Test and production instances are read-only by construction: their credential must hold
  `snc_read_only` (checked before every connection), and commands that change an instance do
  not exist for them, on the CLI or MCP (ADR-0012).
- Supported platforms: macOS on Apple silicon, Linux x64 and arm64, Windows x64.
