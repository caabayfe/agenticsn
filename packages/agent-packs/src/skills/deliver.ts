import type { Skill } from "../skill";

export const DELIVER: Skill = {
  name: "servicenow-deliver",
  description:
    'Deliver ServiceNow changes to the development instance: "deploy", "push", "put it in an update set", "send it to the instance". Shows the plan and waits for the user\'s approval before writing anything.',
  when: [
    "Changes in the workspace that are built and validated, going to a development instance.",
    "Test and production instances cannot be written. To build or fix first, use servicenow-build.",
  ].join("\n"),
  steps: [
    "`status`: when `phase` is not `integrated`, run `pull` and ask the user to run snagentic integrate first.",
    "`plan_push` (with `label` if the user named the update set).",
    "Show the plan: each of the `units` (`operation`, `updateName`, its `changes` and the `losses` the load also sets), the `updateSets`, the `gate`, any `collisions` and `problems`.",
    "Once the plan is `ready` and the user approves it: `push` with `instance`, `plan` set to the `planId`, `confirm` true, and `draftPr` true when the user wants a pull request and the branch has none.",
    "Report the `batch` and `updateSets` with their `link`, the `pullRequest`, each of the `units` pushed, and the `ledgerCommit`.",
  ],
  decide: [
    "`ready` is false: fix what `problems`, the gate's `blocking` findings or `collisions` name, then `plan_push` again. A problem of kind `drift` needs snagentic adopt --refresh; `not-adopted` needs snagentic adopt.",
    "`collisions`: say who holds each record (`heldBy`); set `allowCollisions` only when the user says so.",
    "`push` says the plan changed: run `plan_push` again and show the new plan before pushing.",
    "`pullRequest` status `none`: offer to open a draft pull request (`draftPr`) on the next push; it needs the changes committed first.",
    "`notCaptured` or `notApplied` is above 0: tell the user which units to check on the instance before the update set moves.",
    "The user wants an accelerator pack: `accelerator` with the `pack` and `instance`; show each capability's `state` and its `next` commands. Once every capability is `ready`, run snagentic accelerator add with the pack and instance; for each record it lists to adopt, call `adopt` with the `instance` and the record as table:sys_id in `records`, then make the change its note names in the adopted source; then plan as above.",
    "snagentic accelerator add reports conflicts: they are the user's edits meeting the pack's; resolve them with the user, commit, then plan. Files it says are no longer in the pack are kept: leave them unless the user asks.",
    "The pack has `data` to load: after the push, tell the user to fill its templates outside the workspace and run snagentic accelerator validate-data, then snagentic accelerator load with --confirm themselves.",
  ],
  output:
    "The batch and its update sets (names and links), the units pushed, and what is left: test on the instance.",
  stopAndAsk:
    "Always before `push`: the user approves the plan you showed. Also whenever there are `collisions`.",
  never: [
    "Never push without the user's approval of the plan shown, or with a plan id you did not show.",
    "Never write to the instance any other way (REST calls, background scripts).",
    "Never create, move, rename or delete update sets by hand: push owns the branch's batch.",
    "Never activate plugins or load an accelerator's data yourself, and never read the user's data templates.",
  ],
  prompt: { name: "deliver", description: "Plan and push changes to the development instance" },
};
