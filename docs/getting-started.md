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

Details, a CI example and troubleshooting: [credentials and instance trust](guides/credentials.md).

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
git add AGENTS.md CLAUDE.md .agents .claude .mcp.json .vscode
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

If your agent starts the server elsewhere, set `SNAGENTIC_WORKSPACE` to the workspace path.
Agents can also run any command directly; `--format agent` gives compact output for them.
