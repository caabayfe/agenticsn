# On-call flows captured on pdi15, 2026-11-24

Four flows of a spike for the incident on-call module, published on a development instance
(Brazil patch 2) from Fluent source built with SDK 4.14.3. They are this test's metadata: flow
definitions only, no business record and no credential. The pushing account is normalized to
`admin`. Physical IDs are kept, as the other fixtures keep them.

| Folder | The flow | What it records |
|---|---|---|
| `page-and-watch` | Record Updated; sets flow variables, calls a shipped action and the shipped paging subflow by ID, waits for a condition and for a duration, calls the pack's own action with a scripted input | every step shape below |
| `cancel-on-close` | Record Updated; calls the pack's own action with a scripted input | the scripted input alone |
| `created-or-updated`, `created-or-updated-ends-itself` | Record Created or Updated | that trigger's generated Changed Fields output |

Each folder holds:

- `built.json`: the SDK's build of the flow, as the push reviewed it.
- `capture.xml`: the payload the instance captured in the update set after publishing.
- `native.json`: what the check reads from the instance independently of the capture: the
  trigger definition's outputs, and the input definitions of the actions, flow logic and
  subflows the flow's steps call. The pack's own actions were removed from the instance with
  the spike; their input definitions are taken from the captures of those actions.
- `references.json`: each captured snapshot ID and the definition it is the snapshot of, as the
  check resolves them on the instance.

See ADR-0050 for the rules these captures back, and
`packages/cli/test/adapters/fluent/on-call-flow-capture.test.ts`.
