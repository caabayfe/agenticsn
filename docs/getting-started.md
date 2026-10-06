# Getting started

snagentic mirrors a ServiceNow instance's metadata into a git repository, so you and your
coding agent (Claude Code, GitHub Copilot, Codex…) can read, search and change it as files.
v1.0 syncs everything, keeps it fresh incrementally, and adds update-set and plugin actions.
It never writes metadata to ServiceNow; its only write is activating a plugin on a
development instance.

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
snagentic auth login dev            # stores the password in the OS keychain
snagentic doctor --instance dev     # connection, roles, timestamps, load
```

Secrets never go into the workspace: the keychain, or an environment variable such as
`SNAGENTIC_DEV_PASSWORD` (handy in CI).

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
writes only that plan, into the update set `snagentic: <branch> [<scope>]`, and stops if any
record changed on the instance since the pull. Only development instances can be written.
Accept a finding you cannot fix with a reviewed waiver in `waivers.yaml`:

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

First install the agent pack, once per workspace, and commit it so the whole team gets it:

```sh
snagentic agent install
git add AGENTS.md CLAUDE.md .agents .claude && git commit -m "Add the snagentic agent pack"
```

It adds short instructions to `AGENTS.md` (your own text there is kept) and five workflow
skills in `.agents/skills` (and `.claude/skills`, where Claude Code looks): `servicenow-design` (agree a design before editing),
`servicenow-build` (edit, then `validate` until clean), `servicenow-review`,
`servicenow-explain` and `servicenow-deliver` (plan, approval, push). Run it again after upgrading snagentic; `doctor` warns when the pack is
from another version. In Claude Code the workflows are also slash commands:
`/mcp__snagentic__design`, `/mcp__snagentic__review`, `/mcp__snagentic__explain`,
`/mcp__snagentic__deliver`.

**Claude Code**, from inside the workspace:

```sh
claude mcp add snagentic -- snagentic mcp
```

**GitHub Copilot in VS Code**: add `.vscode/mcp.json` to the workspace:

```json
{
  "servers": {
    "snagentic": { "type": "stdio", "command": "snagentic", "args": ["mcp"] }
  }
}
```

If your agent starts the server elsewhere, set `SNAGENTIC_WORKSPACE` to the workspace path.
Agents can also run any command directly; `--format agent` gives compact output for them.
