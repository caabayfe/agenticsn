# Changelog

All notable changes to snagentic. Versions follow [semantic versioning](https://semver.org).

## [Unreleased]

### Fixed

- `adopt` names why it refuses a protected ServiceNow role whose containment rows have no
  protection: the SDK would mark them read-only, changing who may edit the role's grants. It
  reported an unexplained difference and asked for a bug report. Refusals by design now have
  their own error, which says to leave those records on the instance.
- Plans list what a load sets beyond the source apart from what the source changes, with the
  value: `also sets: sys_app_application.order = 100` instead of the loss's name mixed in with
  the changes.
- `adopt` brings in application menus with an empty order (96 of 217 on a PDI, all baseline).
  The SDK writes order 100 for them; accepted by the product owner as a known loss, so a push
  that loads such a menu shows `also sets: sys_app_application.order = 100` in its plan.
- Plans and adopt read the built XML's character references as text: the build writes a
  carriage return as `&#13;`, which was compared literally, so any text with Windows line
  endings (a role's description, a script) showed as a difference that wasn't there.
- `adopt` brings in UI policies whose actions have an empty message type: three in four on a
  PDI failed to build, because the SDK converts the empty type to a value its own types reject.
  The converted source now says `none`, which the load writes for the empty value (spec 009 X4).
- `adopt` brings in global roles, UI policies with an empty UI type, and inbound actions with
  an empty type. The SDK writes a global role's suffix as its name, desktop for an empty UI type
  and a record action for an empty type; each is accepted only against the instance's empty
  value, so a real change still shows (spec 009 X4). Checked read-only on a PDI: 10 of 10
  roles and 8 of 8 policies.
- `adopt` refuses a script include whose access is empty, with what to set on the instance, rather
  than failing to build: the SDK would have to choose who may call it.
- A change to a script include's `protectionPolicy` or `useEsLatest` alone is now delivered.
  Plans ignored `sys_policy` and never compared the ES-latest row the SDK writes inside the
  script include's update, so they recorded the ledger and loaded nothing (spec 009 B1). The
  ES-latest row is compared only when the source sets a mode; otherwise the instance's stays.
- Removing a role, view or action from a typed array still deletes nothing by itself (the SDK
  emits no deletion for the child row), and plan still refuses it; the refusal now names the
  line to add, such as `Now.del('sys_ui_action_role', '<sys_id>')` (spec 009 B2).
- Roles and views named in source no longer show as a permanent difference. The build writes a
  placeholder sys_id with the name beside it; plans now compare UI action roles and views, ACL
  roles and role containment by name, and by sys_id when the build knew it (spec 009 B3).

## [2.1.0] - 2026-10-17

A mirror complete enough to build a feature (spec 009, ADR-0034), and the security fixes from
the 2.0 audit. Upgrading needs no new workspace: the first pull reads properties and choices
again once, and the local index is rebuilt once.

Not in this release: the mirror secret scan ASR-08 calls for (proposed in ADR-0035). Kept
property values are checked against credential patterns meanwhile.

### Security

- A Fluent build no longer runs the project's build scripts (`now.prebuild.mjs`,
  `now.postbuild.mjs`, or scripts named in `now.config.json`). The SDK ran them inside
  snagentic, with the instance's credentials in reach, so a source change could run code during
  `check` or a plan. A project with build scripts is now refused with an error naming the file
  (S1).
- `adopt` refuses records whose source would hold a value a pull keeps out of the mirror: a
  password or secret-named field, a redacted property value, or a credential class. It wrote
  them into source unredacted. The error names the records and fields, never the values, and
  nothing is written (S2).
- The SDK's requests can't leave the instance: a request it built for another host, scheme or
  port is refused before anything is sent. An absolute URL would have been sent to its own host
  with snagentic's credentials. Checked in the SDK's connector and again in the client.
- `adopt` refuses an application whose scope name, read from the instance, isn't a ServiceNow
  scope name (lowercase letters, digits, underscores and hyphens). It became the folder
  `source/<scope>`, so a crafted name could write elsewhere in the workspace. Files the SDK
  converts are also refused if their path leaves the project.

### Added

- Pulls keep whether a script runs on the latest ECMAScript engine (`sys_es_latest_script`),
  beside the script include, business rule or other script it belongs to
  (`<record>.children.sys_es_latest_script.yaml`; spec 009 mirror plan M1). Existing mirrors gain
  the rows on their next pull.
- Pulls keep the values of system properties that are switches and limits: boolean, integer,
  choice, colour, date or time format and time zone properties that aren't private, whose name
  doesn't look like a secret and whose value has the shape of its type (ADR-0034). Strings,
  passwords, images and private values stay redacted. On a PDI, about 2,650 of 4,250 values.
  The pull reports values redacted for not having their type's shape.
- The first pull after upgrading reads properties and choices again once, so existing mirrors
  gain these values and the choices below without a full pull. Expect one large mirror commit.
- `describe` says what the mirror leaves out on purpose where it matters (ADR-0034): a protected
  record's code is not readable; an inbound email action depends on mail accounts, which are not
  mirrored, and on `glide.email.read.active`, whose value it gives; a flow or action that takes a
  connection alias depends on aliases and connections, which are not mirrored. A table's
  description counts its behaviour with protected code. The local index is rebuilt once.

### Fixed

- Pulls list records in every domain. A full pull, an incremental pull and `pull --verify` missed
  records and child rows outside the session's domain, because the instance hides them from any
  listing with a condition (ADR-0030 #9, spec 009 mirror plan M4). `pull --verify` or the next
  full pull of a domain-separated instance adds the missing ones.
- Pulls keep the choices of flow, action and test step variables, attached to the record that
  defines the variable (`<record>.children.sys_choice.yaml`). They were dropped as orphans: about
  3,500 choices on a PDI. Choices of flow snapshots are still left out, as snapshots are (spec 009
  mirror plan M3).

## [2.0.0] - 2026-10-17

Changes are authored in **Fluent**, the ServiceNow SDK's TypeScript, and every write is loaded
the way the platform records it (ADR-0031, ADR-0032, ADR-0033, spec 008). The workspace layout
changes: create a new workspace (`snagentic init`), add the instances and pull.

### Added

- `adopt` (MCP tool `adopt`): brings records the instance holds into Fluent source under
  `source/<scope>/`. The embedded SDK converts them; snagentic builds the result and checks it
  would rebuild what the instance holds, beyond the SDK's known losses, before writing the
  source and the project's `snagentic.ledger.yaml`. Records the SDK cannot express are named and
  left as they are.
- `adopt --refresh`: brings an instance edit into source, converting as of the last ledger
  commit and merging with local work as git merges.
- The SDK runs inside snagentic, behind snagentic's own connection: every request goes through
  the request scheduler, only reads are allowed, and the SDK never holds a credential.
- `tests/live/fluent-round-trip.test.ts`: adopt, create, update, drift, refresh and delete on a
  development instance.

### Changed

- **The mirror is read-only.** Pull writes it; `check`, the hooks and `validate` (SN-MNT-013)
  refuse edits; integrate takes the instance's copy and names any local edit it discards.
- `plan-push` builds every project and compares each unit (one update) with the instance's
  live copy: it lists what each load changes and what the SDK also sets, and refuses drift,
  records never adopted, definitions removed without `Now.del`, uncommitted source, and flows in
  another domain than the signed-in user's.
- `push` loads each project's units with `fluent/load` into the branch's update sets, stamps
  them as a save would, publishes flows, checks capture, reads every unit back, and commits the
  ledgers.
- `validate` builds the touched projects and runs the record rules, the script rules and the
  ACL checks on what the change added or edited, pointing script findings at the `Now.include`
  file and line. Waivers name `source/<scope>/` paths.
- `integrate` reports adopted units changed on the instance (drift).
- Accelerator packs ship Fluent source and lists of records to adopt (ADR-0026 amended).
- `init` creates `source/global`. `check` only guards which files may be edited. `doctor` is a
  CLI command only; `adopt` takes its MCP place (13 tools).
- ACLs are loaded like any other record.

### Removed

- Editing mirrored YAML and pushing it through the Table API, with the record and child-row
  routing, the hand-built layout writers and the record-aware merge fix-ups of integrate.
- The elevated browser session for ACLs (ADR-0024): `auth login --allow-elevation`,
  `SNAGENTIC_<NAME>_ALLOW_ELEVATION`, and the `playwright-core` dependency.

## [1.8.0] - 2026-10-15

### Added

- Accelerator packs (ADR-0026): ready-made records and data templates for a product area, in
  capabilities installed wave by wave. `accelerator list` and `accelerator check` (MCP tool
  `accelerator`, read-only; the MCP budget is now 13 tools) say whether each capability is
  ready, needs plugins, is not entitled or is blocked, with the commands that make it ready.
- `accelerator add` writes a pack's records into the workspace and applies its patches to the
  mirrored records, on the branch `accelerator/<pack>/<instance>` merged into the current one;
  `validate`, `plan-push` and `push` deliver them as usual. Adding the same version again
  changes nothing, fields pull does not mirror (such as secret-like property values) are never
  written, and a later version merges with your edits: a record it no longer ships is kept and
  reported, never deleted.
- Rule SN-MNT-012 (block): a planned write of a pack capability that is not ready on the
  instance.
- `accelerator validate-data` checks a pack's CSV data templates (mandatory fields, references,
  repeated keys) and refuses a directory git tracks. `accelerator load` loads them into a
  development instance with `--confirm`, one row per request through the pack's import set
  tables, in dependency order, never retried; loading again leaves rows unchanged.
- The deliver skill guides an agent through checking and adding a pack; it never activates
  plugins or loads data itself.
- The binary embeds the packs under its configured pack folders, loaded only by accelerator
  commands. No pack ships in this release; the first, for ITSM, follows.

## [1.7.0] - 2026-10-15

### Added

- Flows, subflows and custom actions, written in Fluent (the ServiceNow SDK's TypeScript
  language) in projects under `source/<scope>/`, and delivered like any other change (ADR-0028).
  `validate` builds every project the change touches; `plan-push` lists each flow, subflow and
  action; `push` loads them into the batch update set, publishes them, and checks the update set
  holds the published versions. A flow that already existed is inactive for a few seconds while
  it is redelivered, which push reports. Mirrored flow records stay read-only.
- The ServiceNow SDK's build (4.13.6) ships inside the binary. It loads only when a command
  builds flows, needs no Node or `node_modules`, and sends no telemetry. `doctor` builds a test
  flow with it (`fluent` check).
- Rules for Fluent projects: SN-MNT-009 (block) build errors, at their file and line;
  SN-MNT-010 (block) IDs not yet in `src/fluent/generated/keys.ts`; SN-MNT-011 (block) records
  the build would delete; SN-UPG-003 (warn) a project that names an SDK version other than
  snagentic's.
- `fluent-keys` writes a project's `keys.ts`, where each new ID's sys_id is fixed once. The
  pre-commit hook runs it on what is staged, so a commit that adds a flow carries its keys.
  Run `snagentic agent install` to update an existing workspace's hook.

### Changed

- The binary is compiled to bytecode: every command starts about twice as fast (`check` on one
  file: p95 54 ms instead of 121 ms on an Apple M-series laptop). It is larger (about 215 MB).
- `validate --staged` builds Fluent projects as the index holds them, so a partial commit is
  checked as it will be committed.

## [1.6.0] - 2026-10-14

### Fixed

- Push finds a form section's changes where the instance records them, as the form that shows
  the section, so sections and their fields are no longer reported as not captured.
- Push moves its own update into the batch when the instance recorded it in the application's
  Default update set instead (seen on pdi2 while another session switched the user's
  preferences). Only updates made by the pushing user are moved; one someone else made stays
  where it is and is reported as not captured (spec 006, B5).
- An incremental pull reads the child rows of a record new to the mirror, though they are older
  than it: choices created before their table, or layout rows before their section, were never
  pulled. Only the child tables that record's class owns are asked (spec 006, B4).
- After a scoped push, the user's global current update set is what it was. A scoped write
  makes the instance switch it to the scope's update set; push now takes and restores that
  preference too (found by spike S11 on pdi2).

### Added

- Rule SN-MNT-008 (warn): a scoped application's server script that opens another scope's
  table (`new GlideRecord('sys_user')`) or calls another scope's script include
  (`new global.Helper()`) without a cross-scope privilege for it in the application's
  `sys_scope_privilege` files. Runtime access tracking records privileges only in interactive
  sessions, so scheduled and event scripts failed silently (spec 006, B8).
- Domains (ADR-0027). Push writes a record's domain on every create: its `_meta.sys_domain`,
  or global when the file names none, never the domain of the user's session. Changing
  `_meta.sys_domain` moves the record, as an update the plan shows. `status` lists the
  instance's domains when it has any besides global, and the build skill says which domain to
  build in. Spike S12 showed the instance honours the domain on insert and update and carries
  it in the update set.

## [1.5.1] - 2026-10-13

### Fixed

- The pre-commit hook checks what is being committed: `validate --staged` reads the index, so
  untracked files and unstaged edits no longer block a commit (or integrate's merge commit).
  Run `snagentic agent install` to update an existing workspace's hook.
- On a domain-separated instance, a record created here and pulled back in the domain the
  instance gave it (`domains/<domain>/…`) is recognised as the same record: integrate keeps
  one file, and the next plan updates it instead of creating it again. A record's identity is
  its scope, class and sys_id; its domain is an attribute (spec 006, A2).
- Integrate says when the pre-commit check blocked its merge commit, with what it reported,
  and leaves the merge to finish; before, it reported a bug in snagentic.

## [1.5.0] - 2026-10-13

### Added

- Choice lists are mirrored and pushed. Pull writes a table's choices beside its table record
  (`<table>.children.sys_choice.yaml`); the first pull after upgrading reads them all. Push
  creates new choices and updates changed ones (ADR-0025).
- Form and list layouts are pushed: rows of `sys_ui_element`, `sys_ui_list_element`,
  `sys_ui_form_section` and `sys_ui_related_list_entry` can be added and changed in their
  owner's file, and push writes them after the owner. A table built by an agent can ship with
  its choices, form and list. Removed rows are refused with the way to retire them.
- Scoped applications are created from files: add a `sys_app` record in the new scope's
  folder and push writes it first, in the scope's update set, then the application's other
  records. Pull mirrors custom applications as records of their own scope, and keeps the
  vendor prefix (`glide.appcreator.company.code`) so agents can name the scope.
- Agents may edit those five child-row files; flow, workflow and variable-value rows stay
  read-only.

### Fixed

- Push creates records in their own application. The Table API ignores the `sys_scope` an
  insert is sent and uses the user's current application, so a new record in a scoped app was
  created in global (tables renamed `u_...`). Push now makes each scope's application current
  while writing it, and restores the user's current application and update set afterwards.
- Push opens each update set in its own application. The instance creates an update set in
  the user's current application and will not move it afterwards, so a scope's child update
  set was created as global and its writes fell into the application's Default update set.
  Push now makes global current to open the batch, and each scope's application current to
  open its child, checks the result, and stops before writing anything when it is wrong. A new
  application is written first, as its update set can only be created once it exists, and its
  update is moved into that update set.
- A push that fails reports the write that failed; a preference it could not restore stays in
  the push journal and is restored by the next push. A preference the instance replaced while
  the push ran is found again by user and name.
- A pull goes on when an inventory signal times out on a busy instance (seen on pdi2: the
  plugin count exceeded the instance's maximum execution time). That source counts as
  unchanged, keeps its last signature and is checked again by the next pull.
- An ACL's roles are counted however the YAML quotes the reference, so `validate` no longer
  blocks an ACL whose role records were written with quoted values.
- Push checks capture under the update name the platform gives a record. A list
  (`sys_ui_list_<table>_<view>`) and other records not named `<table>_<sys_id>` were reported
  as not captured.
- Integrate takes the instance's child-row file when it confirms every row added or changed
  here, and moves a record's child files with it only when they are confirmed.

## [1.4.1] - 2026-10-13

### Fixed

- `integrate` takes the instance's copy of an ACL pushed from here, even though ServiceNow
  replaced its description. The platform generates an ACL's description from its operation,
  table and roles, so the description pushed never comes back. Integrate no longer counts that
  as a local change and no longer stops with "one record in two files that differ".
- When integrate does stop on a record in two files, its hint says which file to keep instead
  of naming conflict markers that are not there.

## [1.4.0] - 2026-10-13

### Added

- `push` writes ACLs (`sys_security_acl`, `sys_security_acl_role`) on development instances
  you allow with `snagentic auth login <instance> --allow-elevation` (or
  `SNAGENTIC_<NAME>_ALLOW_ELEVATION=true` in CI). It signs in to the instance in a headless
  Google Chrome or Microsoft Edge, elevates to `security_admin` only, writes the ACLs last
  into the branch's update set, and signs out. No manual step is left. Needs a password login
  (not single sign-on) and Chrome or Edge installed (ADR-0024).
- `validate` checks ACL records: SN-SEC-006 blocks a write, create or delete ACL that no role,
  condition or script restricts; SN-SEC-007 blocks deactivating, deleting or allowing a deny
  ACL; SN-SEC-008 warns when admin overrides are turned off.

### Fixed

- `integrate` stops when git refuses to start the merge, naming the untracked files in the way
  (an interrupted integrate leaves copies of the pulled files). Before, it committed anyway and
  the pre-commit hook checked every one of those files, which took hours on a full pull.
- `integrate` is no longer blocked by findings the instance already had. The pre-commit hook
  validated every record the pull brought in, so a pull that activated a plugin with vendor
  code could never be integrated. During integrate's merge, validate now checks only records
  that differ from the instance's version; a conflict resolved by hand is still checked.
- A record created in the workspace may have any file name in its scope and class folder, as
  long as it ends with its sys_id. `plan-push` no longer asks to rename it: pull names files
  after `sys_name`, which the platform sets when the record is created, so no name chosen
  before the push was reliably right, and following the advice left two files for one record.
- `plan-push` finds a record the mirror holds under another file name by its sys_id, and plans
  an edit to it as an update. Before, it planned creating the record again.
- `integrate` keeps the instance's file name for a record pushed from here and removes the
  local file, when the instance's copy holds every field set locally. When they differ, it stops
  and names both files.
- `integrate` compares a pushed record's scripts and HTML too, ignoring a trailing newline, and
  ignores the fields pull withholds, such as a property's value. Before, these conflicted.
- `push` writes what other records refer to first: a table before its fields and choices, a
  role before its ACLs, a UI policy before its actions, an event before its notification.
  Before, records were written in file order.
- `plan-push` refuses ACLs (`sys_security_acl`, `sys_security_acl_role`) on an instance not
  allowed to elevate, and says how to allow it. Before, the push stopped part way with the
  records before it already written.
- `plan-push` refuses choices (`sys_choice`): pull does not mirror them yet, so every later
  plan would have created them again.
- `plan-push` and `status` say when a push stopped part way, until a pull shows what it wrote.
  Before, the plan said "ready" and listed records already written as new.
- A write the instance refuses says "the instance refused …" with what to do. Before, it said
  the user "may not read" it and suggested excluding it from the sync.
- The hints after `push` and on plan errors name `snagentic pull <instance>` and
  `snagentic integrate <instance>`. Before, they used an `--instance` option those commands
  do not have.
- `check` after an edit fails on a record file that does not exist, and the post-edit hook
  says deleting records is not supported. Before, it reported "check passed" having checked
  nothing.

### Security

- Agents may not run commands that read stored credentials (`security find-generic-password`,
  `security dump-keychain`, `secret-tool lookup`, `cmdkey`): deny rules for Claude Code and
  the pre-shell hook for other hosts. Run `snagentic agent install` again to add them.
- Agents may not set `SNAGENTIC_<NAME>_ALLOW_ELEVATION` in a shell command, like the other
  credential variables.

## [1.3.0] - 2026-10-08

### Added

- `snagentic upgrade [--to <version>]` replaces snagentic with the latest release (or the one
  named), after checking it against the release's `SHA256SUMS` and that it runs. Inside a
  workspace it also refreshes the agent pack, and it shows the upgrade steps of every release
  skipped over (ADR-0023). Agents cannot run it.
- After a command, at most once a day, snagentic says when a newer release exists. Never in CI,
  in MCP, hook, agent or JSON output, or with `SNAGENTIC_NO_UPDATE_CHECK=1`.

## [1.2.1] - 2026-10-08

### Fixed

- `integrate` no longer stops on a record created in the workspace and pushed. The instance's
  copy comes back with the fields the platform fills in, so git saw the same file added on both
  sides. When that copy holds every field set locally with the same value, `integrate` takes it
  and says so; any other conflict is still left for you to resolve.

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

### ⚠️ Changed: one update set batch per pull request

`push` writes each branch, and so each pull request, into its own **update set batch**:
`snagentic: <branch>` holds the global changes, with a child `snagentic: <branch> [<scope>]` per
other application scope, so a pull request that spans scopes is promoted as one batch. An update
set an earlier version opened as `snagentic: <branch> [global]` is not reused: complete or merge
it on the instance.

### Added

- `push` links the branch's open pull request from its update set batch, found with the GitHub
  CLI (`gh`) when it is installed and signed in; `--pr <url>` names it instead. `--draft-pr`
  opens a draft pull request when the branch has none, before writing to the instance: it
  pushes the branch and refuses while planned changes are uncommitted (ADR-0022). snagentic
  never handles a GitHub token; `gh` stays optional.
- `agent install --host all|claude|copilot` installs only what the chosen host reads. GitHub
  Copilot (CLI and cloud agent) gets native hooks in `.github/hooks/snagentic.json`, with the
  same checks as Claude Code, and the `.agents/skills` workflows. Agents can't edit
  `.github/hooks/`.
- OAuth client credentials as an alternative to a password (ADR-0021):
  `instance add --client-id <id> --username <OAuth application user>`, then `auth login`
  asks for the client secret. Tokens stay in memory and are renewed before they expire. Guide:
  [credentials](docs/guides/credentials.md#with-an-oauth-client-instead-of-a-password).

### Known issue

- After pushing a **new** record, `integrate` reports a conflict on its file: the instance's
  version adds the fields the platform fills in (`api_name`, `sys_name`, defaults, `_meta`).
  When every field you set has the same value in it, take the instance's version
  (`git checkout --theirs <file>`, `git add`, `git commit`). Updates integrate cleanly. Fixed in
  the next version.

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
