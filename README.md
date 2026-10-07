# snagentic

**Build ServiceNow with any coding agent, in git, with guardrails.**

snagentic mirrors a ServiceNow instance's metadata into a git repository, so developers and
their coding agents (Claude Code, GitHub Copilot, Codex, Cursor…) can understand, change and
review it as files. Changes go back to a **development** instance through a validated,
reviewed plan, into a normal update set. Test and production stay read-only by construction.

```text
ServiceNow instance ──pull──▶ git workspace ──▶ agent + developer edit files
        ▲                                              │
        └──── push (development only) ◀── plan ◀── validate (24 platform rules)
```

> Status: **v1.1.0**. Sync, knowledge, guardrails and delivery to development instances.
> See the [changelog](CHANGELOG.md) and the [roadmap](docs/product/overview.md#roadmap).

## Why

ServiceNow work happens in the browser, one record at a time. Teams can't easily see what
already runs on a table, review a change before it lands, or let a coding agent help, because
the agent can't see the instance. Generic AI assistants then write code that ignores what
already exists and breaks platform practice.

snagentic puts the whole instance on disk, gives agents the right ServiceNow tools and
advice, and enforces checks in code instead of trusting prompts.

## What it does

| | Capability | Commands and tools |
|---|---|---|
| **Develop** | Mirror every metadata record into git; keep it fresh incrementally with almost no instance load; edit records as files; push a reviewed plan to a development update set | `pull`, `integrate`, `status`, `plan-push`, `push` |
| **Understand and audit** | Find anything in the instance in milliseconds; explain a table's behavior in execution order (client scripts, UI policies, business rules, notifications, ACLs); show who uses a record | `find`, `describe`, `update-sets`, `plugins` |
| **Guardrails** | Advice before building (least custom option first); 24 platform rules for security, performance, upgradability, manageability and UX, reporting only what a change introduced; checks after each agent edit, at commit and inside `push` | `advise`, `validate`, `check`, hooks |
| **Agents** | One MCP server with 12 tools, five workflow skills (design, build, review, explain, deliver), short instructions and host hooks, installed with one command and shared through git | `mcp`, `agent install` |

## Safe by design

- **Production is read-only by construction.** For test and production instances, write
  commands are not registered at all, and the credential must hold `snc_read_only`, checked
  before every connection.
- **Every push is gated.** It needs a plan id, passing validation (or a reviewed, expiring
  waiver), user confirmation and an unchanged remote record. It writes only into its own
  update set and verifies each write was captured.
- **Light on the instance.** Keyset paging, named fields, an adaptive request scheduler.
  An incremental pull with no changes costs 22 small requests and about 4 seconds.
- **No secrets on disk.** Credentials (a password or an OAuth client) live in the OS keychain or environment variables, each
  bound to the instance URL and kind it was stored for, so editing a file can't redirect it
  or make production writable ([credentials](docs/guides/credentials.md)).
  snagentic sends instance data nowhere except your machines and your git server; what your
  coding agent reads goes to that agent's model provider, under your agreement with it.
- **Enforcement isn't left to the agent.** Skills and instructions guide it; hooks,
  permission rules, the git pre-commit hook and the push gate enforce.

Details: [security and governance](docs/product/security-and-governance.md).

## Install

macOS (Apple silicon) and Linux:

```sh
curl -fsSL https://github.com/caabayfe/agenticsn/releases/latest/download/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://github.com/caabayfe/agenticsn/releases/latest/download/install.ps1 | iex
```

One self-contained binary; its only prerequisite is `git`. The installers check SHA-256 sums.
The binaries aren't signed yet, so Gatekeeper and SmartScreen may warn on first run.

## Quick start

```sh
snagentic init ~/snagentic/acme && cd ~/snagentic/acme
snagentic instance add dev --url dev12345 --username svc_snagentic --kind development
snagentic auth login dev
snagentic pull dev && snagentic integrate dev
snagentic agent install        # instructions, skills, hooks and MCP (--host claude|copilot)
```

Then ask your agent, for example: *"Why does the assignment group change when I save an
incident?"* or *"Make Business service mandatory for P1 incidents."*

The full walkthrough is in [getting started](docs/getting-started.md); every command and
MCP tool is in the [command reference](docs/reference/commands.md).

## Documentation

| For | Read |
|---|---|
| Stakeholders and decision makers | [Product overview](docs/product/overview.md) |
| Security and architecture reviewers | [Security and governance](docs/product/security-and-governance.md) |
| Users | [Getting started](docs/getting-started.md), [command reference](docs/reference/commands.md) |
| Contributors | [AGENTS.md](AGENTS.md), [requirements](docs/architecture/significant-requirements.md), [decisions (ADRs)](docs/adr/README.md) |
| Evidence | [Pull baseline](docs/reports/pull-baseline-pdi.md), [performance targets](docs/reports/v1.0-targets.md), [agent evaluation baseline](docs/reports/agent-eval-baseline-2026-10-06.md) |

## Build from source

Requires [Bun](https://bun.sh) 1.4 and git.

```sh
bun install
bun run verify      # typecheck, lint, architecture rules, size limits, tests
bun run build       # writes dist/snagentic
```

## License

The license hasn't been chosen yet ([ADR-0008](docs/adr/0008-commercial-boundary.md)).
Until then, all rights are reserved.
