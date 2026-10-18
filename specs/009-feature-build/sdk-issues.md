# 009. ServiceNow SDK issues found by the adopt census: drafts to file

- Status: Drafts for the product owner to file at the SDK's issue tracker
  (https://github.com/ServiceNow/sdk/issues)
- Date: 2026-10-18
- SDK: `@servicenow/sdk` 4.13.6 (latest on 2026-10-18)
- Found by: the test plan's L1 census on a personal developer instance (PDI) (`test-plan.md`): each record converted
  with the SDK's transform (`metadata` method), built, and compared with the instance. No
  instance data is quoted below; each report describes the record shape that reproduces it.

How snagentic handles each one today is noted, so the reports can be closed on our side when
the SDK fixes them (`conversion-fixes.ts`, `losses.ts`, `refusals.ts` are tied to the SDK
version).

## 1. Transform writes values its own Fluent types reject

| Record | Instance value | Transform writes | Type expects | Records on the PDI | snagentic today |
|---|---|---|---|---|---|
| `sys_ui_policy_action` | `field_message_type` empty | `fieldMessageType: ''` | `'error' \| 'info' \| 'warning' \| 'none'` | 4,776 of 5,350 | rewrites to `'none'` |
| `sys_script_include` | `access` empty (global) | `accessibleFrom: ''` | `'public' \| 'package_private'` | 47 | refuses |
| any with `sys_policy` | `read-only`, `read_only` or `true` (legacy) | `protectionPolicy: 'read-only'` … | `'read' \| 'protected'` | 6 | refuses |
| `sys_script_include` | `access` `private` | `accessibleFrom: 'private'` | `'public' \| 'package_private'` | 1 | refuses |
| `sys_ui_policy` | `short_description` empty | `shortDescription: ''` | non-empty | 12 | refuses |

**Expected:** an empty or legacy value converts to the API's default or is omitted, as the
plugin's `.def()` does for absent values (`field_message_type` maps `$.from(...).def('none')`,
but `.def` applies only to `undefined`, not `''`).

## 2. Transform crashes on an empty number field

`sys_ui_policy` with `run_scripts=true` and `ui_type` empty: transform throws
`Cannot coerce value to number:` (`getUITypeFromId(toNumber(''))`). Also seen on 1 flow.
**Expected:** empty converts as desktop (0), as the build's own default does.
**snagentic:** refuses with what to set on the instance.

## 3. Transform drops `ui_type` for a policy that runs no scripts

`UiPolicy`'s transform sets `uiType` only when `runScripts` is true; the build then writes
`ui_type = 0` (desktop). A policy for all UIs (10) or mobile (1) with scripts off becomes
desktop-only: 37 policies. The type allows `uiType` without `runScripts`.
**Expected:** transform keeps `uiType` whatever `runScripts` is.
**snagentic:** refuses (it would change where the policy applies).

## 4. Converted flows and actions don't type-check

The transform of existing Flow Designer flows and actions produces source that fails `tsc` in
the SDK's own build. On the PDI, 11 of 150 flows and 22 of 150 actions sampled (beyond sections 1 and 5):

| Error | Flows | Actions |
|---|---|---|
| `No overload matches this call.` | 1 | 17 |
| `Property '<name>' comes from an index signature, so it must be accessed with ['<name>']` (document, stage, state, source_record, sys_id) | 6 | 1 |
| `'_params.trigger.current.<field>' is of type 'unknown'` / `'_params.inputs.<a>.<b>' is of type 'unknown'` | 3 | 0 |
| `Argument of type '{ label: string; mandatory: true; maxLength: number; }' is not assignable …` | 0 | 2 |
| `Output '<name>' is declared but not assigned in assignActionOutputs` / `assignActionOutputs is used but no outputs are declared` | 0 | 2 |
| `SetFlowVariables: Values object cannot be empty` | 1 | 0 |

**Expected:** transform output builds, or the transform names what it can't express.
**snagentic:** refuses with "the SDK's conversion doesn't build (an SDK limitation)".

## 5. Transform can't find a complex object type

`unable to find sys_complex_object with co_type_name: FD<id>` for actions (5) and a flow (1)
whose inputs or outputs use a complex object type defined on the instance.
**Expected:** the transform reads the complex object it needs, or names it as unsupported.

## 6. Children inherit the parent's protection policy

`Role`, `UiPolicy` and `UiAction` propagate the parent's `protectionPolicy` to child rows
(`propagateSysPolicyToDescendants`). Where the instance's child rows have another policy (none,
on ServiceNow's own protected roles and policies), a load changes who may edit them: 6 roles,
34 UI policies, 25 UI actions.
**Expected:** a child row's own `sys_policy` is kept when it was read from the instance.
**snagentic:** refuses.

## 7. Defaults written where the instance holds nothing (lower priority)

Accepted by snagentic as named losses, but worth reporting so the SDK can keep the empty value:
a global role's `suffix` becomes its name (632 of 646 global roles); `ApplicationMenu` and
`UiAction` write `order: 100` for an empty order (96 menus, 2 UI actions); an empty UI policy
script becomes `function onCondition() {}`; a mobile menu (`device_type`) can't be expressed by
`ApplicationMenu`.

## 8. An adopted flow's snapshot is written as an empty update file

Building an adopted flow writes `dist/app/sys_hub_flow_snapshot_<id>.xml` containing only the
XML declaration. Harmless to load, but tools reading the build see an update file with no
record. **snagentic:** skips files with no element (since PR #87).
