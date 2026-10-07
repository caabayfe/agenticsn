# Changelog

All notable changes to snagentic. Versions follow [semantic versioning](https://semver.org).

## [Unreleased]

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
