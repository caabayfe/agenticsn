# Spike S11: delivering flows from files

Gate for spec 005 (product owner, 2026-10-13: flows are a core capability; nothing else starts
until flow delivery is proven). Not product code.

## Question

Can an agent author a Flow Designer flow (or subflow, or action) as files in the workspace, and
can snagentic deliver it to a development instance so that it:

1. is **published and runs** (the trigger fires, the actions execute);
2. **opens and edits in Flow Designer** without errors;
3. is **captured in the branch's update set** and moves to another instance;
4. **pulls back** into the mirror, and a second change round-trips the same way?

## Why it is hard

- A flow is a `sys_hub_flow` record plus child rows (`sys_hub_*_instance_v2`, logic, stages,
  `sys_variable_value`). The `values` field of each v2 row is gzipped, base64 JSON: not
  authorable as it is mirrored today.
- A flow only runs from its compiled snapshot (`sys_hub_flow_snapshot`, `master_snapshot`),
  which the platform produces when the flow is published. Pull excludes snapshots, and ADR-0025
  keeps flow child rows read-only for this reason.

## What step 1 found (read-only, pdi2, 2026-10-13)

- No flow has ever been captured in an update set on pdi2, so the update record's shape is
  unknown here.
- `/api/now/processflow/flow/<id>` exists (404 for a missing flow, not "unknown resource"): the
  Flow Designer's own internal API. Undocumented.
- `/api/sn_cicd/update_set/preview/<id>` exists (POST only). S9 showed a non-ACL update record
  can be inserted into a remote update set through the Table API.
- The ServiceNow SDK (Fluent) has a documented **Flow API** (`@servicenow/sdk/automation`):
  flows, subflows, record, scheduled and application triggers, 20+ core actions, data pills.
  `now-sdk build` turns it into update XML (`dist/app/update/*.xml`); `$id` is hashed into a
  stable sys_id. Global applications are supported.

## Routes to test

| Route | Authoring | Delivery | Risk |
|---|---|---|---|
| **R1. Fluent → update XML → remote update set → CI/CD commit** | TypeScript (Fluent), readable, typed | `now-sdk build`; snagentic loads the XML into a remote update set (Table API), previews and commits through the CI/CD API, inside the branch's batch | Does the commit publish and compile the flow? Is the result captured in the batch? |
| **R2. Fluent → `now-sdk install`** | same | ServiceNow's own installer | A second delivery model beside push; capture in update sets; global vs scoped |
| **R3. Flow Designer internal API** | snagentic's own readable flow format | `processflow` endpoints, as the designer calls them | Undocumented; may need a browser session (ADR-0024 pattern) |
| **R4. Records through the Table API, then publish** | decoded v2 `values` as YAML | push writes rows; publish through R3's endpoint | Writes compiled-from structures by hand; ADR-0025 rejected it |

R1 is the preferred outcome: documented authoring, one delivery path that keeps the plan, gate
and batch. R2 and R3 are fallbacks; R4 only if all else fails.

## Experiments (pdi2, development)

Scratch artifacts are named `snagentic spike S11` / `x_<prefix>_s11` and deactivated afterwards.

1. **Shape.** Create one small flow in Flow Designer (record created on `incident` → add a work
   note) in a scratch update set; read its update records: one composite record or many, does it
   carry the snapshot.
2. **R2 baseline.** A Fluent app with the same flow; `now-sdk build`, inspect `dist/app/update`;
   `now-sdk install`; check experiments 1–4 of the question.
3. **R1.** Load the built XML of a second flow into a remote update set through the Table API;
   preview and commit through the CI/CD API; check the four criteria, and whether the commit
   lands in the current update set (the batch).
4. **Global.** Repeat the winner with a flow in global scope (the accelerator configures global
   tables; most of its flows can still live in `x_nttdata_acc`).
5. **Round trip.** `snagentic pull`: what the mirror holds; change the Fluent source, deliver
   again; check that the edit replaces, not duplicates.
6. **R3 probe** (only if R1 and R2 fail): record the designer's calls for create and publish.

## Decision this feeds

An ADR on flow delivery (authoring format, delivery route, how it fits plan, gate and batch,
what pull mirrors), before spec 005 track A starts.

## Results so far (2026-10-13, pdi2, Australia patch 7)

Scripts: `probe.ts`, `instance-facts.ts`, `endpoints.ts` (read-only); `sdk.ts` (runs now-sdk with
the profile's credential in the child's environment only); `activate.ts`, `raw.ts`, `domain.ts`.

1. **Authoring works offline.** `@servicenow/sdk` 4.13.6, `now-sdk build` on a Fluent flow
   (record created on `incident` → update record with a work note) builds without an instance.
   `now-sdk explain` documents flows, subflows, custom actions, stages and every trigger type.
2. **A flow is one composite update record.** `dist/app/update/sys_hub_flow_<id>.xml` holds the
   flow, its trigger and action instances (v2), with `delete_multiple` for removed rows: the
   same unit the platform captures in update sets. It is built as **`status: draft`,
   `active: false`, with no snapshot.**
3. **Publishing is a separate call.** `now-sdk install` loads the package through
   `POST /api/fluent/load/<scope>` (a rollback context is created), then publishes with
   `POST /api/now/wfa_fluent/activate_flows?sysparm_transaction_scope=<scope>` and
   `{ flows: [sys_id], actions: [sys_id] }`. The endpoint belongs to the ServiceNow IDE
   application on the instance; it is not in the public REST API reference.
4. **Install succeeded, publish failed** on pdi2: "Could not update a flow defined in global
   domain from TOP/Default domain". The user `admin` is in domain `TOP/Default`; the flow was
   created in `global`. Domain Support is in use on pdi2.
5. Calling the activation endpoint directly with basic auth answers 400 "No valid sys_id values
   found in flows or actions" for the same flow (cause not yet known: domain visibility of the
   REST session is the first suspect).
6. Moving `admin` to the global domain to test the publish was **not done**: it changes the
   instance's user configuration and needs the owner's decision.

Left on pdi2: application `x_2222332_s11` ("snagentic spike S11") with one draft, inactive flow.
Rollback: `sys_rollback_context.do?sys_id=91ce379383ff8710292aca75eeaad337`.

### Update: request format

- Point 5 above was a wrong request format, not domains. The endpoint's `sys_ws_operation`
  (mirrored, script protected) documents `flows` and `actions` as objects:
  `{ "sys_id": ..., "active": "true", "state": "" }`.
- With that format, called directly with basic auth and no domain change, it answers 422
  `PUBLISH_FAILED` with the same domain message as the SDK. **The domain is the blocker.**
- A first owner-run test with `admin` moved to `global` used the old format, so it proved
  nothing; `admin` was restored. `activate.ts` now sends the documented format.

### Update: published and running (owner-run publish, admin briefly in `global`)

- **Publish works over REST** with basic auth when the session user is in the flow's domain:
  `isPublished: true`, master snapshot `8b23c4ef…`, status `published`, active. `admin` was
  restored to `TOP/Default` afterwards.
- **Criterion 1 met.** Test incident INC0010002 ("S11 spike: …") ran the flow
  (`sys_flow_context` COMPLETE within 5 s) and got the work note "S11 flow ran (v1)".
- **The designer's API loads it cleanly** (`/api/now/processflow/flow/<id>`: errorCode 0, trigger
  and action instances present). Opening it in the Flow Designer UI is still to be checked by eye.
- **Capture: the publish is what lands in the update set.** `fluent/load` (the install) created
  no update record. The publish created one composite record `sys_hub_flow_<id>`, type "Flow",
  in the session's current update set (here "Default"). So whatever loads the draft, setting
  the scope's update set preference before publishing (as push already does, spec 004 step 3)
  should put the whole flow in the branch's batch. To be proven next.
- **Running from a scoped app created a cross-scope privilege at run time**
  (`x_2222332_s11` → `incident`, Write, Allowed), also captured in "Default". A pack must
  declare its cross-scope privileges, or test and production will block the flow.
- **Domain finding:** the user that publishes must be in the flow's domain. On an instance with
  domain separation, a user in `TOP/Default` cannot publish a `global` flow.

### Update: redelivery and capture (admin moved to `global` by the owner, 2026-10-13)

- **Redelivery works.** v2 was loaded and published; INC0010003 got "S11 flow ran (v2)". v3 and
  v4 were published the same way.
- **Loading a new version stops the live flow until it is republished.** After `fluent/load`
  the flow is `draft`, inactive, until the publish call; on a busy instance, triggers in that gap
  are missed. Load and publish must be one step, close together.
- **`now-sdk install` resets the user's update set preferences** (`sys_update_set` and
  `updateSetForScope<scope>`) to the application's Default set. Admin's global current update set
  was changed by it; its earlier value is unknown.
- **The publish is captured as one complete record:** `sys_hub_flow_<id>`, type "Flow", 33 KB,
  holding the flow, trigger, action, logic, variables, inputs, stage, and the compiled
  `sys_hub_flow_snapshot`, with `active: true`. This is what moves to test.
- **It was captured in the app's "Default" set, not the selected one**, in every variant:
  preferences set before the load, after the load, and with the scratch set created inside the
  scope (a set created while global is current lands in Global and is ignored by the scope).
- **Control: plain Table API writes behave the same.** With `apps.current_app` and
  `updateSetForScope<scope>` set exactly as push sets them, a Table API update of the flow and a
  brand-new `sys_properties` row in the scope both landed in "Default".
- **Push is affected too (product finding, outside this spike).** The Access Review app
  (`x_2222332_acc_rev`), written by push today, has 149 update records in "Default" and 1 (the
  `sys_app`, moved by `moveUpdate`) in `snagentic: access-review [x_2222332_acc_rev]`. Records
  were still landing in Default at 19:53 UTC, after the scoped batch set existed (19:52 UTC).
- **Moving the update works.** Setting `sys_update_xml.update_set` (push's `moveUpdate`) moved the
  complete flow record into the scoped set. Until the preference cause is found, capture by
  moving each written record's update into the batch is a working route.

Left on pdi2 (all scope `x_2222332_s11`, safe to delete): the app and flow (published, v4),
property `x_2222332_s11.control`, update sets "snagentic spike S11: scoped capture" (holds the
flow) and two empty "snagentic spike S11: capture" sets in Global; incidents INC0010002 and
INC0010003. Rollback contexts: `91ce3793…`, `925480e3…`, `a4a4486b…`, `5ee4c067…`.

### Update: capture resolved (clean runs, 20:34–20:37 UTC, no other writer on pdi2)

- **Earlier misses were contamination, not a flaw in push's method.** Another session's push was
  switching admin's preferences in the same minutes (it shares the user), and `now-sdk install`
  resets them. Run alone, push's preferences (`apps.current_app` and `updateSetForScope<scope>`,
  with the set created inside the scope) capture correctly:
  - a new scoped `sys_properties` row landed in the scoped set (`capture-matrix.ts`, variant A);
  - **a never-delivered flow** (flow B), loaded, then the set selected, then published, landed
    complete in the scoped set; both flows published and active.
- The Access Review records in "Default" are explained by the other session's spike S12: its
  child sets were created while Global was current (fixed in 1.5.0), and admin was in
  `TOP/Default` until 20:24 UTC.
- **Delivery order for flows:** load the draft, then select the batch's set, then publish. The
  publish is what writes the update record, so the set only has to be current at publish time.
- **Platform side effects on preferences (affect push):**
  - a scoped write replaces the `updateSetForScope<scope>` row (new sys_id), so a restore by the
    remembered sys_id gets 404; push already finds it again by user and name;
  - a scoped write also sets the global `sys_update_set` preference to the scoped set. Push never
    switched that preference, so it never restores it: after a scoped push, the user's current
    update set stays on the batch's child set. Restored by hand here to the global "Default".
- **Two writers as one user interfere.** Preferences are per user, not per session: a push, a
  spike or a person in the UI using the same user at the same time can move each other's writes
  into the wrong set. Push's capture check should report it; a per-user lock or a dedicated
  integration user per writer avoids it.

### Update: designer and pull (2026-10-13)

- **Flow Designer** (`$flow-designer.do#/flow-designer/<id>`) renders flow B like a native flow:
  trigger "incident Created where Short description starts with S11B", action "Update incident
  Record", data pills, Active, Published, domain global, application "snagentic spike S11". It
  opened read-only with "Edit flow" disabled; an out-of-box global subflow opened the same way in
  the same browser session, so that is the session, not the delivery. (Workflow Studio's own URL
  stayed blank; the classic URL redirects into Workflow Studio and loads.)
- **Pull** (repo source, 1.5.1; the mirror was already current at `0762909cf7`) holds, under
  `x_2222332_s11/`: the `sys_app`; each flow as one `sys_hub_flow` record with
  `.children.sys_hub_trigger_instance_v2.yaml` and `.children.sys_hub_action_instance_v2.yaml`;
  `sys_hub_flow_input` records for each flow and for each snapshot; the SDK's `sys_module`
  package files; the properties; and the run-time `sys_scope_privilege`. Redeliveries (v2 to v5)
  kept one flow, one file: same sys_ids.

## Conclusion

Route proven: Fluent source → SDK build → `fluent/load` → select the batch's update set →
`activate_flows` → capture check. Decision drafted as ADR-0028. Still open: a flow in global
scope, and moving the batch to a second instance.
