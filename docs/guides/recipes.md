# Recipes: what else you can do

Short, complete examples for the capabilities besides "change one thing on one instance". Each
names the command, shows the result you should see, and links where it is explained in full. Run them
in a workspace with a pulled, integrated development instance (`dev`); see [sync](sync.md).

Fluent snippets below follow the projects and fixtures the test suite uses
(`tests/fixtures/fluent/kitchen-sink`, `tests/fixtures/accelerators`), written for the shipped SDK (4.14.0). Names
are examples: let `validate` and `plan-push` confirm yours.

## Understand and audit

### Why does this happen when I save?

```sh
snagentic describe incident
```

Lists, in execution order, the client scripts, UI policies, business rules (before, after, async),
notifications and ACLs that act on the table, including what it inherits. Follow a result with
`describe <mirror path>` for the record and what refers to it.

### Where is this used?

```sh
snagentic find "assignment_group" --code --table incident   # inside scripts
snagentic find "Assign by category"                         # records by name
snagentic find --class sys_script --scope x_acme --limit 50 # a list
```

### What is installed, and what is in flight?

```sh
snagentic plugins list dev incident --state inactive        # from the pulled inventory
snagentic update-sets list dev                              # open and recent, with counts
snagentic update-sets collisions dev                        # records held by two open sets (exit 1 if any)
```

### Troubleshoot a production issue without touching production

Add production as a **read-only** profile, pull it, and read it like any mirror:

```sh
snagentic instance add prod --url acme --username svc_readonly --kind production --acknowledge-read-only
snagentic auth login prod && snagentic pull prod
snagentic describe incident --instance prod
```

The credential must hold `snc_read_only`. Write commands for production don't exist, so nothing here
can change it. Never run background scripts or flows against production to "look".

## Change

### Change something that already exists

```sh
snagentic adopt --instance dev instances/dev/metadata/global/sys_script/<name>--<sys_id>.yaml
# edit the files adopt lists under source/<scope>/, then:
snagentic validate && snagentic plan-push
```

When someone changes it on the instance meanwhile: `pull dev`, `integrate dev`, then
`snagentic adopt --instance dev --refresh <record>`; both sides are kept and overlaps become
conflicts, as in git.

### Delete something

Removing a definition from source deletes nothing. Say so explicitly:

```ts
Now.del('sys_ui_list', { name: 'incident' })   // by the record's keys
Now.del('prb_model', 'dc6e1da1dee511cd23fa0de321d02c93')   // or by its sys_id
```

`plan-push` refuses a deleted definition until you add the `Now.del` or restore it.

### A system property and an ACL

```ts
import { Acl, Property } from '@servicenow/sdk/core'

Property({
    $id: Now.ID['p1_check_enabled'],
    name: 'x_acme.p1check.enabled',
    type: 'boolean',
    value: true,
    description: 'Turns the P1 business service check on',
    roles: { read: ['admin'], write: ['admin'] },
})

Acl({
    $id: Now.ID['incident_read_itil'],
    type: 'record',
    table: 'incident',
    operation: 'read',
    roles: ['itil'],
    description: 'Only itil reads incidents',
})
```

`validate` checks ACLs too: a write, create or delete ACL that nothing restricts, a deny ACL turned off
or deleted, and admin overrides turned off. They load with no elevated session.

### A new scoped application

A feature belongs in its own application, not global.

1. In `source/global`, create the application record and push it:

   ```ts
   import { Record } from '@servicenow/sdk/core'

   Record({
       $id: Now.ID['x_acme_p1_app'],
       table: 'sys_app',
       data: {
           name: 'P1 control',
           scope: 'x_acme_p1',
           short_description: 'Controls that apply to P1 incidents',
           version: '1.0.0',
       },
   })
   ```

   The scope starts with `x_`, the instance's company code and `_`; the code is the value of
   `glide.appcreator.company.code`, which pull mirrors.
2. Create `source/x_acme_p1/now.config.json` with the scope, the application's sys_id (from
   `source/global/src/fluent/generated/keys.ts`) and the type:

   ```json
   {
       "scope": "x_acme_p1",
       "scopeId": "<the application's sys_id>",
       "name": "P1 control",
       "type": "configuration"
   }
   ```
3. Write the application's records in `source/x_acme_p1/src/fluent/`, validate and push as usual.

### A flow

Flows, subflows and custom actions use `Flow`, `Subflow` and `Action` from `@servicenow/sdk/automation`.
A daily flow that looks up open P1 incidents:

```ts
import { action, Flow, trigger, wfa } from '@servicenow/sdk/automation'

export const dailyP1 = Flow(
    { $id: Now.ID['daily_p1_flow'], name: 'Daily open P1s', runAs: 'system' },
    wfa.trigger(
        trigger.scheduled.daily,
        { $id: Now.ID['daily_p1_trigger'] },
        { time: Time({ hours: 3, minutes: 0, seconds: 0 }, 'UTC') }
    ),
    () => {
        wfa.action(
            action.core.lookUpRecords,
            { $id: Now.ID['daily_p1_lookup'] },
            { table: 'incident', conditions: 'active=true^priority=1', max_results: 5 }
        )
    }
)
```

`push` loads the flow into the batch, publishes it and checks the update set holds the published
version. A flow that already existed is inactive for a few seconds while redelivered: records
created meanwhile don't trigger it.

### Any other table

```ts
import { Record } from '@servicenow/sdk/core'

Record({
    $id: Now.ID['category_hardware'],
    table: 'sys_properties',
    data: { name: 'x_acme.example.limit', type: 'integer', value: '5', description: 'An example limit' },
})
```

Typed APIs (`Table`, `BusinessRule`, `ClientScript`, `UiAction`, `UiPolicy`, `Role`, `List`, `Form`)
are better where they exist; `Record` is for the rest, with the table's column names as `data`.
Choices, form layouts and list layouts are children of their table or form: `adopt` the existing one
rather than writing it from nothing.

## Review

### Check a change before the pull request

```sh
snagentic validate                  # since the last commit
snagentic validate --base main      # everything the branch changes against main
snagentic docs impact --base origin/main   # which documentation the change makes stale
```

Findings have a severity (`block` stops a push; `warn` should be fixed or accepted) and a rule ID such
as SN-PERF-001. For one you can't fix, add a reviewed waiver (`waivers.yaml`, getting started,
[waivers](../getting-started.md#waivers)): only committed waivers apply, and agents can't edit the file.

### Let the agent review

`/mcp__snagentic__review` (Claude Code), or "review this change": the `servicenow-review` skill reads
the diff against the instance's existing behavior and the rules, and reports what it can't verify.

## Deliver

### Several scopes, one pull request

Each branch gets one update set batch: `snagentic: <branch>` for the global changes and a child
`snagentic: <branch> [<scope>]` for each other scope. Push the branch again from any machine and the
open batch is reused. With the GitHub CLI signed in, the batch description links the pull request;
`push --draft-pr` opens a draft one.

### Inspect or hand over an update set

```sh
snagentic update-sets show dev <sys_id>        # its updates, without payloads
snagentic update-sets export dev <sys_id>      # ServiceNow "Export to XML", into .snagentic/dev/exports/
```

Updates whose payload holds a secret or a value shaped like one are left out and listed.

## Install

### A store application or a plugin

```sh
snagentic plugins activate dev com.snc.some_plugin --confirm      # development only, never retried
snagentic apps install dev sn_itsm_advanced --confirm             # store application, followed to the end
snagentic pull dev                                                # bring in what was installed
```

Add `--demo-data` to load the application's own demo data; snagentic can't remove it.

### An accelerator pack

A pack is ready-made Fluent source and data templates for one product area ([ADR-0026](../adr/0026-accelerators-as-content-packs.md),
[ADR-0038](../adr/0038-accelerator-install-and-platform-components.md)).

```sh
snagentic accelerator list
snagentic accelerator check itsm --instance dev          # each module: ready, needs-components, not-entitled or blocked
snagentic accelerator install itsm dev --demo            # writes the plan for a platform admin; changes nothing
snagentic accelerator install itsm dev --demo --confirm <planId>   # runs exactly that plan; resumes if stopped
```

The plan lists components to activate, each module's update set, the out-of-box records changed, the
data to load and the risks. Read it, hand it to the platform admin, and confirm only what they approved.
For your own data instead of demo data, fill the CSV templates in a folder **outside** the workspace:

```sh
snagentic accelerator validate-data itsm --data ~/customer-data
snagentic accelerator install itsm dev --data ~/customer-data --confirm <planId>
```

Customer data is never committed, and snagentic refuses a folder git tracks. To install on a new
PDI in one run, see [onboarding](onboarding.md).

### A domain-separated instance

`status` lists the instance's domains, and records outside global mirror under
`domains/<domain sys_id>/<scope>/<class>/`. Build an application's logic in global; a customer's own
change sets `$override: { sys_domain: '<domain sys_id>' }` on its definition (ADR-0027).

## Operate

### Share the mirror with a team

[Team mode](team-mode.md): one scheduled pull publishes; everyone else runs `integrate`.

### Upgrade snagentic

```sh
cd <your workspace>
snagentic upgrade                  # verifies the checksum and build provenance, refreshes the agent pack
```

Commit the files it lists. `snagentic upgrade --to 2.19.1` goes back to a version.

### Something is off

```sh
snagentic doctor --instance dev
```

Checks git, the keychain, the search index, the proxy and certificates, the clone's git settings,
line endings, and the instance's credentials, connection, roles and timestamps.
