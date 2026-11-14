# Build a new capability: a worked example

This guide takes one change from request to a development instance, with every command and the
files you will see. It uses a small, realistic capability: **a P1 incident can't be resolved
without a business service.**

You need a workspace with a development instance already pulled and integrated
([getting started](../getting-started.md), sections 1 to 4) and, for the agent route, the agent
pack installed (section 8 there). Commands are the same from the CLI, through your agent's MCP
tools, or by asking the agent in plain words.

```text
design ─▶ understand ─▶ branch ─▶ write Fluent ─▶ validate ─▶ plan-push ─▶ push ─▶ pull + check
```

## 1. Make sure the mirror is current

```sh
snagentic status
```

`status` says what to do next (`pull`, `integrate`, or nothing). Run what it says before you
design anything: advice and `describe` read the mirror, and a stale mirror gives stale answers.

## 2. Understand what already runs

```sh
snagentic describe incident            # everything that runs on save, in execution order
snagentic find "business service" --table incident        # records by name on the table
snagentic find "business_service" --code --table incident  # and scripts that mention it
snagentic advise "make business service mandatory when a P1 is resolved" --tables incident --phase design
```

`advise` lists the platform's options, least custom first, with what already exists on the
table. For this request the least custom option is usually a UI policy or a data policy; choose a
server-side business rule only when the requirement must hold for imports and APIs and a data
policy can't express it. **Agree the choice before writing code**: with an agent, the
`servicenow-design` skill does exactly this and stops to ask you.

This example uses a before business rule so the check also holds for integrations.

## 3. Work on a branch

```sh
git switch -c feat/p1-needs-business-service
```

Every branch gets its own update set batch (`snagentic: <branch>`), so name the branch for the
change. Source must be committed before `plan-push`.

## 4. Write the Fluent source

New records go in the scope's project, `source/<scope>/src/fluent/<feature>.now.ts`. For a
global change, that is `source/global/`. (A real feature belongs in its own scoped application;
see [A new application](../getting-started.md#a-new-application).)

`source/global/src/fluent/p1-business-service.now.ts`:

```ts
import { BusinessRule, ScriptInclude } from '@servicenow/sdk/core'

ScriptInclude({
    $id: Now.ID['p1_business_service_check'],
    name: 'P1BusinessServiceCheck',
    script: Now.include('./p1-business-service-check.server.js'),
    description: 'A P1 incident needs a business service before it is resolved',
})

BusinessRule({
    $id: Now.ID['p1_needs_business_service'],
    name: 'P1 needs a business service to resolve',
    table: 'incident',
    when: 'before',
    action: ['update'],
    script: Now.include('./p1-needs-business-service.server.js'),
})
```

`source/global/src/fluent/p1-needs-business-service.server.js`:

```js
(function executeRule(current, previous) {
    if (new P1BusinessServiceCheck().blocks(current)) {
        gs.addErrorMessage(gs.getMessage('A P1 incident needs a business service before it is resolved'));
        current.setAbortAction(true);
    }
})(current, previous);
```

`source/global/src/fluent/p1-business-service-check.server.js`:

```js
var P1BusinessServiceCheck = Class.create();
P1BusinessServiceCheck.prototype = {
    initialize: function () {},

    blocks: function (incident) {
        return incident.priority == 1 &&
            incident.state.changesTo(6) &&
            incident.business_service.nil();
    },

    type: 'P1BusinessServiceCheck'
};
```

Rules to follow, all enforced by `validate`:

- Every `$id` is a stable `Now.ID['<name>']`. Never write the sys_id yourself; the SDK assigns it
  on first build (see [generated keys](../getting-started.md#generated-keys)).
- Scripts live in files pulled in with `Now.include`, so rules can read them.
- Reference things by name or property, never a hard-coded sys_id (SN-MNT-001).
- To change a record the instance already holds, `adopt` it first instead of writing a copy
  (below).

Other typed APIs follow the same pattern: `Table`, `ClientScript`, `UiAction`, `UiPolicy`,
`Acl`, `Role`, `Property`, `List`, `Form`, and `Record({ table, data })` for any table; flows use
`Flow`, `Subflow` and `Action` from `@servicenow/sdk/automation`. Ask your agent, or read an
existing project under `source/`, for the exact fields of the one you need.

### Changing something that already exists

```sh
snagentic describe instances/dev/metadata/global/sys_script/<name>--<sys_id>.yaml
snagentic adopt --instance dev instances/dev/metadata/global/sys_script/<name>--<sys_id>.yaml
```

`adopt` converts the record to Fluent under `source/<scope>/`, checks the result would rebuild
what the instance holds, and writes `snagentic.ledger.yaml`. Edit the files it lists; never the
mirror, never the ledger.

## 5. Validate until clean

```sh
snagentic validate
```

It builds each project you touched and reports what **your change introduced**. A `block`
finding stops the push; a `warn` should be fixed or accepted. For a finding you can't fix, add a
reviewed [waiver](../getting-started.md#waivers).

Commit. The pre-commit hook runs the SDK build and writes
`src/fluent/generated/keys.ts` with your new IDs, adding it to the commit:

```sh
git add source && git commit -m "feat: a P1 needs a business service to resolve"
```

## 6. Plan, review, push

```sh
snagentic plan-push
snagentic push --instance dev --plan <planId> --confirm
```

`plan-push` lists every unit the push would load, what the SDK also sets, collisions with other
open update sets, and drift on records someone changed on the instance. Read it; a plan you
haven't read is a plan you can't approve. `push` loads only that plan into the branch's update
set batch, checks each load was recorded and reads it back.

## 7. Check it on the instance

```sh
snagentic pull dev        # the new records appear in the mirror
snagentic describe incident
```

The business rule now shows in `describe`'s execution order. Then try it in the browser:
resolve a P1 with and without a business service. If the push touched other people's records
you will have seen it in the plan's collisions.

Open the pull request. Promote the update set batch to the next instance the way your team
does; snagentic never writes to test or production.

## When something goes wrong

| Symptom | What to do |
|---|---|
| `plan-push` refuses: source not committed | Commit, then plan again. |
| `plan-push` reports drift | Someone changed an adopted record on the instance. `pull`, then `adopt --refresh <record>` merges their change into your source. |
| `validate` reports SN-MNT-010 | New IDs aren't in `keys.ts`. Commit through the pre-commit hook, or run `snagentic fluent-keys source/<scope>`. |
| `adopt` refuses a record | It lists the differences it can't explain. Adopt the others and tell the instance owner about that one. |
| `push` stopped part way | `status` shows an unfinished push. Plan and push again to finish it. |
| Anything about the connection | `snagentic doctor --instance dev`. |

## Build it with your agent

With the agent pack installed, you can give the same request in one sentence: *"Make Business
service mandatory when a P1 incident is resolved."* The agent runs `servicenow-design`, which
shows the options and waits for your choice; then `servicenow-build`, which adopts or writes the
source and runs `validate` until clean; then `servicenow-deliver`, which shows the plan and asks
for your approval before it pushes. Skills guide; the gate, hooks and your approval enforce.

Next: [extending snagentic](extend-snagentic.md) if the capability you need is a new command,
rule or skill rather than a change to an instance.
