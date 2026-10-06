# Changelog

All notable changes to snagentic. Versions follow [semantic versioning](https://semver.org).

## [1.0.0] - unreleased

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
