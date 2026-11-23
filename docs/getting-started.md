# Getting started

snagentic mirrors a ServiceNow instance's metadata into a git repository, so you and your
coding agent (Claude Code, GitHub Copilot, Codex…) can read, search and change it as files.
It syncs everything and keeps it fresh incrementally, explains and searches the mirror,
checks changes against platform rules, and pushes reviewed changes to development update
sets. It writes only to development instances; test and production are read-only.

New to snagentic? The [product overview](product/overview.md) explains what it is for.
Every command is described in the [command reference](reference/commands.md).

Use `snagentic --help` for everyday commands grouped by task, and
`snagentic <command> --help` for required flags, defaults, effects and examples.
`snagentic --help-all` also lists advanced commands (`init`, `take-over`) and host/hook
commands (`mcp`, `hook`, `check`, `fluent-keys`). They remain directly callable; hiding
them from the everyday list changes no permissions or enforcement.

Guides for what comes next: [onboard an instance](guides/onboarding.md), [sync](guides/sync.md),
[build a capability](guides/build-a-capability.md), [spec-driven development](guides/spec-driven-development.md),
[generate documentation](guides/generate-documentation.md) and [recipes](guides/recipes.md).

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

Behind a corporate proxy or TLS inspection? Set `HTTPS_PROXY`, `NO_PROXY` and
`NODE_EXTRA_CA_CERTS` in your environment; `doctor` shows what is in effect. See
[network: proxies and corporate certificates](guides/network.md).

**Upgrading.** Once a day snagentic checks for a new release and, when there is one, prints
`snagentic <version> is available: run snagentic upgrade` after a command. Then:

```sh
cd <your workspace>       # optional: also refreshes its agent pack
snagentic upgrade         # or: snagentic upgrade --to 1.2.0, to go back
```

`upgrade` checks the new binary against the release's `SHA256SUMS`, its build provenance (with
`gh` signed in; otherwise it says it couldn't), and that it runs before replacing the old one.
It refreshes the workspace's agent pack (commit the files it lists), and shows the steps of any release you skipped, such as logging in again. snagentic never updates
itself, and agents cannot run `upgrade`. The notice stays quiet in CI, in agent and JSON output,
and with `SNAGENTIC_NO_UPDATE_CHECK=1`.

## 2. Create a workspace

In a hurry? `snagentic onboard dev --url dev12345 --username <user>` does sections 2 to 4 in one
command and says what to do if the instance is asleep or refuses the user
([onboarding](guides/onboarding.md)). The steps below are what it does, one at a time.

Synced data lives in its own git repository, never inside your application code:

```sh
snagentic init ~/snagentic/acme
cd ~/snagentic/acme
```

Every command works from any folder inside the workspace (or pass `--workspace <path>`).

`init` also writes `instances/** -text` into the workspace's `.gitattributes`, so git checks the
mirror out byte for byte on every platform, Windows with `core.autocrlf=true` included. A
workspace created by an earlier version lacks it: `snagentic doctor` reports it
(`mirror-line-endings`), and the [team-mode guide](guides/team-mode.md#line-endings) has the
one-time steps to add it, including the command that checks a Windows clone's mirror out again
with LF:

```sh
git rm -r --cached -q instances
git checkout HEAD -- instances
```

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

The username comes from `SNAGENTIC_DEV_USERNAME` if set, then this clone's identity (set with
`auth login dev --username <you>`), then `instance.yaml`; `doctor` and `instance list` say which.

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

The routine, and what to do when it goes wrong, is in the [sync guide](guides/sync.md).

```sh
snagentic pull dev          # the first pull is complete and resumable
snagentic integrate dev     # merges it into your working branch
snagentic status            # freshness, pending integrations, local changes
```

The first pull of a large instance takes a while (the PDI: about 30 minutes for 463,000
records). It pages carefully and adapts to the instance's load; if interrupted, run it
again and it resumes.

After that, `pull` is incremental: when nothing changed it costs about 22 small requests
and a few seconds, and it reports the requests it sent. Every few days, or when in
doubt, compare the mirror with the instance by counts and repair what differs:

```sh
snagentic pull dev --verify
```

It also reads again the changed records an earlier pull could not store, the ones `pull` and
`status` count as not stored, and says for each one still missing what the instance answered.

On a development instance, `snagentic pull dev --cost` also reads the server time the run
used from the instance's transaction log. That read is itself expensive on a busy instance,
so it runs only when asked, and never on test or production (ADR-0053).

**Instance load.** Every command and agent call in one process shares one request queue per
instance. By default snagentic sends at most 4 requests at once and 10 per second to a
development instance, 2 at once and 5 per second to test and production, and at most 20,000
requests per run. An instance owner can lower these in the committed `instance.yaml`:

```yaml
load:
  max_concurrency: 1
  requests_per_second: 2
  request_budget: 5000
```

Values there can only lower the limits; a higher value is ignored, so a commit can never raise
the load on an instance. Whoever runs the machine or the CI job can also set
`SNAGENTIC_DEV_MAX_CONCURRENCY`, `SNAGENTIC_DEV_REQUESTS_PER_SECOND` and
`SNAGENTIC_DEV_REQUEST_BUDGET` (named after the instance, like its credential variables). These
too only lower concurrency and rate; `SNAGENTIC_DEV_REQUEST_BUDGET` may raise the budget for a
large instance. A run that reaches its budget stops; run it again and a full pull resumes where
it stopped. A request that times out slows snagentic down and is retried once (a listing with a
smaller page).

Records live in a flat layout:
`instances/dev/metadata/<scope>/<class>/<name>--<sys_id>.yaml`, with scripts and other long
fields in files next to them (`….script.js`) and child rows (flow steps, form layouts) in
`….children.<table>.yaml`. This mirror is **read-only**: it is the instance as last pulled, for
searching, describing and reviewing. Changes are written as Fluent source (section 7); the hooks,
`validate` and integrate keep the mirror as pull wrote it.

Each pull commit also carries the state it was pulled with, in `instances/dev/pull/`: the
watermark, fingerprints and catalog. A clone that has the `servicenow-remote/dev` branch
continues with an incremental pull, never a full one.

### Team mode: one pull per instance

In a team, one designated puller (a scheduled CI job, signed in as a service account) pulls the
instance and publishes the mirror branch. Everyone else gets it through git. Name the git remote
when you add the instance, or add `shared_mirror` to `instance.yaml` and commit it:

```sh
snagentic instance add dev --url dev12345 --username svc_ci --shared-mirror origin
```

```yaml
shared_mirror:
  remote: origin
  max_age_minutes: 30   # at least twice the puller's schedule (every 15 minutes in the template)
```

The designated puller runs:

```sh
snagentic pull dev --publish   # fast-forward only; refused for a user other than the mirror's
```

Developers sign in once as themselves; `instance.yaml` keeps naming the puller:

```sh
snagentic auth login dev --username jdoe   # this clone signs in as jdoe from now on
```

Then they run:

```sh
snagentic status          # the shared mirror's age, and whether it holds pulls you lack
snagentic integrate dev   # fetches the shared mirror, then merges it
snagentic pull dev        # continues from the shared mirror; nothing is asked of the
                          # instance while it is current, nor while it is stale and
                          # the puller's run is late (--now pulls anyway)
```

`pull`, `integrate` and `status` call the git remote with your own git credentials. Instance
secrets never reach git. Protect `servicenow-remote/*` on the git host, so that only the
designated puller can push it. The mirror shows the instance as that user sees it, so give that
user read access to everything the team works on. A pull by any other user adds and changes
records but never removes one just because its own listing left it out.

The [team-mode guide](guides/team-mode.md) has the full setup: the scheduled CI pull template,
branch protection, the puller's read access, who signs in, and troubleshooting.

## 5. Update sets

Read live from the instance, so always current:

```sh
snagentic update-sets list dev                  # open and recently changed, with counts
snagentic update-sets show dev <sys_id>         # its updates, without payloads
snagentic update-sets collisions dev            # records held by two open sets (exit 1 if any)
snagentic update-sets export dev <sys_id>       # ServiceNow "Export to XML" format
```

An export goes to `.snagentic/<instance>/exports/` unless you pass `--output`, so it is never
committed by accident. Updates whose payload holds a secret, or a value shaped like one, are left
out and listed: move them by hand.

## 6. Plugins

```sh
snagentic plugins list dev incident --state inactive     # from the pulled inventory
snagentic plugins activate dev com.snc.some_plugin --confirm
snagentic pull dev                                       # brings in what it installed
```

Activation uses ServiceNow's CI/CD API, works on development instances only, and is never
retried automatically: if its outcome is unclear, snagentic tells you what to check.

## 7. Deliver changes to a development instance

For one change followed from request to instance, with the files and commands, see
[build a new capability](guides/build-a-capability.md).

Changes are written in **Fluent**, the ServiceNow SDK's TypeScript, one project per application
scope under `source/<scope>/` (ADR-0031). snagentic ships the SDK (4.14.0) inside the binary: no
Node, no `node_modules`, no telemetry. `init` creates `source/global`; a scope's project appears
when you first adopt one of its records.

```sh
snagentic adopt --instance dev instances/dev/metadata/x_acme/sys_script_include/util--<sys_id>.yaml
# edit source/x_acme/src/fluent/... and commit
snagentic validate                      # builds the projects, checks what the change introduced
snagentic plan-push                     # each unit the push would load, the gate, collisions
snagentic push --instance dev --plan <planId> --confirm
```

- **adopt** brings records the instance holds into source. The SDK converts them (it reads the
  instance through snagentic's own connection, never with a credential of its own, ADR-0032),
  snagentic builds the result and checks it would rebuild what the instance holds, then writes
  the source and the project's `snagentic.ledger.yaml`. Name records by mirror path,
  `table:sys_id` or sys_id. A difference beyond the SDK's known losses refuses the adoption;
  records the SDK cannot express (such as table licensing configs) are reported and stay as they
  are.
- **New records** are written in Fluent directly: `Table`, `BusinessRule`, `ScriptInclude`,
  `ClientScript`, `UiAction`, `UiPolicy`, `Acl`, `Role`, `List`, `Form` and the other typed APIs,
  or `Record({ table, data })` for any table. Give every `$id` a stable `Now.ID['<name>']`, and
  keep scripts in `Now.include('./<name>.server.js')` files.
- **Deleting** is explicit: `Now.del('<table>', { <keys> })`. Removing a definition from source
  deletes nothing, and the plan refuses it until you add the `Now.del` or restore it.
- **plan-push** builds every project and compares each unit (one update: a record, or a list or
  section with its rows) with the instance's live copy. It lists what each load changes and what
  the SDK also sets (`losses`), and refuses a unit someone changed on the instance since it last
  agreed with source (**drift**), a record you never adopted, and source not committed.
- **push** loads each project's units into the branch's update sets with `fluent/load`, stamps
  them as a save would, publishes flows, checks each was recorded and reads it back, then commits
  the projects' ledgers. Only development instances can be written.
- **Incomplete delivery** stays in `.snagentic/<instance>/push-journal.json` until content,
  capture and the ledger commit are verified. An applied change without capture remains in
  the next plan, even when source already equals live. Review that new plan before retrying;
  keep the original instance and batch label. Remote edits and legacy journals without
  evidence block the retry. See [delivery recovery](../specs/014-delivery-verification/plan.md#recovery).
- **Drift**: when someone changes an adopted record on the instance, pull it, then
  `snagentic adopt --instance dev --refresh <record>`. It converts the instance's copy as of your
  last ledger commit and merges it into your source as git merges: both sides kept, overlaps
  marked as conflicts.

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

### Generated keys

The SDK gives each new `Now.ID` a sys_id the first time it builds, in
`src/fluent/generated/keys.ts`. You never write it by hand: the pre-commit hook (`snagentic agent
install`) builds what is staged, writes the new IDs and adds the file to the commit. Without the
hook, run `snagentic fluent-keys source/<scope>` and commit `keys.ts` with the source; `validate`,
`plan-push` and CI block a project whose keys are missing.

### A new application

A new feature belongs in its own scoped application. Add it to `source/global` as a
`Record({ table: 'sys_app', data: { name, scope, version: '1.0.0' } })` and push it. The scope
starts with `x_`, the instance's company code and `_`; the code is the value of
`glide.appcreator.company.code`, which pull mirrors. Then create `source/<scope>/now.config.json`
with the scope, the application's sys_id (from `source/global/src/fluent/generated/keys.ts`) and
`"type": "configuration"`, and write the application's records there.

### Domains

On a domain-separated instance (managed service providers run one domain per customer),
`snagentic status` lists the instance's domains, and records outside global are mirrored under
`domains/<domain sys_id>/<scope>/<class>/`. Build an application's logic in global; a customer's
own change sets `$override: { sys_domain: '<domain sys_id>' }` on its definition (ADR-0027).
`adopt` refuses a layout whose rows live in a domain the SDK would not keep.

### Flows

Flows, subflows and custom actions use `Flow`, `Subflow` and `Action` from
`@servicenow/sdk/automation`. `push` loads them into the batch, publishes them, and checks the
update set holds the published versions. A flow that already existed is inactive for a few
seconds while it is redelivered: records created meanwhile do not trigger it. A flow in a domain
the signed-in user is not in is refused by the plan, as the instance would not publish it.

### ACLs

ACLs (`sys_security_acl`, with their roles) are authored in Fluent like any other record, and
`push` loads them with no elevated session: the load route writes them as the platform does
(ADR-0031, spike S16). `validate` checks ACLs: a write, create or delete ACL that nothing
restricts, a deny ACL turned off or deleted, and admin overrides turned off.

### Waivers

Accept a finding you cannot fix with a reviewed waiver in `waivers.yaml`. The path must start
with `source/<scope>/`. Working alone, only waivers committed on the current branch apply. In a
team (the profile has a `shared_mirror`), only waivers already merged to the remote's default
branch apply, for example `origin/main`: open a pull request for the waiver, and run `git fetch`
once it is merged. Claude Code and Copilot CLI hooks refuse an agent's edit to the file; other
hosts have no such protection, so review every change to `waivers.yaml` in the pull request:

```yaml
waivers:
  - rule: SN-MNT-001
    path: source/x_acme/src/fluent/legacy-util.server.js
    reason: Known group, replaced in STRY0012345
    approver: lead@example.com
    expires: 2027-03-31
```

### Accelerators

An accelerator pack is ready-made Fluent source and data templates for one product area, in
modules you install by profile or one by one (ADR-0026, ADR-0031, ADR-0038). snagentic never activates plugins or
loads data on its own, and a pack's source goes through `validate`, `plan-push` and `push` like
your own:

```sh
snagentic accelerator list
snagentic accelerator check <pack> --instance dev  # each module: ready, needs-components, not-entitled or blocked
snagentic accelerator add <pack> dev       # writes source/<scope>/..., on the branch accelerator/<pack>/dev, merged here
snagentic adopt --instance dev <table>:<sys_id>   # for each record add lists, then edit it as its note says
snagentic validate && snagentic plan-push  # then push as usual
```

`check` reads the mirrored plugin and application list, so pull after activating a plugin or
installing an application; for a module that is not ready it prints the commands that make it
ready, and it warns when the pack was not tested on the instance's platform release. `add`
refuses until every selected module is ready and the latest pull is integrated. Without a
selection it takes every module; `--profile <name>` takes a profile's modules and `--modules`
names them one by one, each with the modules it depends on. It copies the pack's Fluent source into the projects under `source/`, and lists the
out-of-box records the pack customizes: adopt each one, then make the change its note
describes in the adopted source. snagentic never changes an out-of-box record for you. Adding
the same version again changes nothing. A later version merges with your edits: conflicts are
left for you, and a file the new version no longer ships is kept and reported, never deleted.
The gate blocks a planned project that a module no longer ready ships source into
(SN-MNT-012).

The pack's data (groups, locations, offerings) comes as CSV templates, one per entity. Fill
them in a directory outside the workspace: customer data is never committed, and snagentic
refuses a directory git tracks. `--demo` uses the pack's own fictional demo data instead. After
the push:

```sh
snagentic accelerator validate-data <pack> --data ~/customer-data       # mandatory fields, references, repeated keys
snagentic accelerator load <pack> dev --data ~/customer-data --confirm  # development instances only
```

`load` validates everything first, then posts one row per request through the pack's import set
tables, in dependency order, never retrying, and stops after the first entity with rows the
instance did not take. Loading again updates or leaves rows unchanged; it never duplicates them.
On test and production, load the same templates on the instance itself.

## 8. Use it from your coding agent

To document a process, the agent uses the `servicenow-document` skill: see
[generate documentation](guides/generate-documentation.md).

The executable bundles the MCP server, eight workflow skills and query guidance. New
workspaces created with `init` or `onboard` install the integration automatically. For an
existing workspace, or on a teammate's machine after cloning, run:

```sh
snagentic agent install
git add AGENTS.md CLAUDE.md .claude/settings.json .github/hooks .mcp.json .vscode .codex
git commit -m "Configure the snagentic agent integration"
```

Skills are shared at user level: `~/.agents/skills/servicenow-*` for Codex and Copilot,
and `~/.claude/skills/servicenow-*` for Claude Code. The binary installs the versions it
embeds; no separate MCP package, skill checkout or Node runtime is required. It keeps hashes
in `~/.snagentic/agent-pack/skills.json`, updates unchanged owned files and preserves edited
or unowned skills. Review every `skipped` path: a preserved project skill may shadow the new
user skill. Exact generated copies from 2.21.1 are removed from the current workspace after
successful user installation; other repositories are never scanned or rewritten.

Each workspace retains its marked `AGENTS.md` block, host hooks, git hook and MCP bindings.
Your own instructions and unrelated MCP servers are preserved. Upgrading refreshes shared
user skills and the current workspace integration, and reports refresh failures. Commit this workspace
configuration; each teammate installs their own personal skills. Outside a workspace,
`agent install` installs only personal skills. For cloud or ephemeral runners that cannot
access your home directory, use `snagentic agent install --scope workspace` in that runner.
Avoid mixing skill scopes in the same environment. Personal skills are not distributed by git.

Two profiles run from the same executable and shared engine:

| Profile | Purpose | Command |
|---|---|---|
| Investigate | Mirror context plus live table pages, records, counts and inherited schema; only read operations | `snagentic mcp --profile investigate` |
| Develop | Advice, adoption, validation, plans and gated delivery to development | `snagentic mcp --profile develop` |

The installer registers both profiles. Enabling both adds their tool definitions to the
host's context; disable an unused server in the host if you only investigate or develop.
The existing `snagentic mcp` remains compatible with its 13 tools. Production credentials
still require verified read-only roles, and write tools are absent without a development
profile. Separating servers does not create a separate credential security boundary.
Collaboration servers are configured independently.

The skills cover design, build, review, explain, deliver, document, troubleshoot and test.
They activate for snagentic workspaces and use CLI/MCP operations. The troubleshooting skill
includes corrected query guidance. Testing distinguishes executed tests from static
validation and proposed runtime cases; the binary has no ATF/background-script executor.
Build Agent/AI Agent and Jira/Confluence/Figma workflows are not installed.

### Choosing the agent host

By default `agent install` sets up every supported host (`--host all`). Select one with
`snagentic agent install --host claude`, `--host copilot` or `--host codex`.

| Host | User skills | Workspace configuration |
|---|---|---|
| Claude Code | `~/.claude/skills` | `CLAUDE.md`, `.claude/settings.json`, `.mcp.json` |
| Copilot CLI / VS Code | `~/.agents/skills` | `.github/hooks/snagentic.json`, `.mcp.json`, `.vscode/mcp.json` |
| Codex | `~/.agents/skills` | `.codex/config.toml` (trusted projects) |

Custom server entries and invalid configuration files are preserved and reported as skipped.
An unchanged generated legacy server is migrated to the two profiles. Review customized
legacy bindings manually to avoid loading duplicate servers. Hosts may ask you to trust the
workspace or enable its servers; installing files does not bypass that host decision.

### Reading live data

Live investigation needs a configured profile and trusted credentials, but no metadata pull.
Use the mirror for broad code searches and live reads for the specific runtime evidence:

```sh
snagentic query schema --instance dev --table incident
snagentic query record --instance dev --table incident \
  --sys-id 0123456789abcdef0123456789abcdef --fields number active
snagentic query table --instance dev --table incident --fields sys_id number active \
  --query 'sys_updated_on>=2026-11-01 00:00:00^sys_updated_on<2026-11-08 00:00:00' --limit 10
```

Choose actual UTC bounds for your investigation. Every `^NQ` branch needs equality/IN on
`sys_id` or a dictionary-unique field, or explicit UTC `sys_updated_on` bounds within 31 days.
Validated conditions can refine that selection; executable expressions and unbounded scans
are refused. `^OR` joins adjacent alternatives; `^NQ` joins whole groups with OR. Field names
and reference hops are checked against live schema. Secrets are masked before output.

On a test or production instance these commands are off until the instance's committed
`instance.yaml` has `live_queries: { enabled: true }`. Each query that runs adds one line,
without filter values or results, to `.snagentic/<name>/live-queries.jsonl`; see "Live queries"
in [security and governance](product/security-and-governance.md).
Reuse `nextCursor` with the same instance, identity, table, query, fields and limit. Results are transient and
ACL-limited; an empty result cannot establish global absence. Schema inspection pages the
visible dictionary and includes ancestors, not descendants. Aggregate supports count and
one group field (maximum 100 groups), rather than arbitrary REST or sum/avg/min/max.

`AGENTS.md` and the git pre-commit hook are always installed. Copilot CLI runs the hooks in
`.github/hooks` only in folders you have trusted, so trust the workspace when it asks. Copilot
CLI also reads `.claude/settings.json`, so with `--host all` it runs each check twice; that is
harmless, but `--host copilot` avoids it. A hook that times out lets the action through, so
the hooks allow two minutes; the pre-commit hook and the push gate still apply.

If your agent starts the server elsewhere, set `SNAGENTIC_WORKSPACE` to the workspace path.
Agents can also run any command directly; `--format agent` gives compact output for them.
