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
    "Show the plan: each of the `changes` (operation, path, `fields`), the `updateSets`, the `gate`, any `collisions` and `problems`.",
    "Once the plan is `ready` and the user approves it: `push` with `instance`, `plan` set to the `planId`, and `confirm` true.",
    "Report the `updateSets` with their `link` and what was `written`; then `pull`, and tell the user to integrate.",
  ],
  decide: [
    "`ready` is false: fix what `problems`, the gate's `blocking` findings or `collisions` name, then `plan_push` again.",
    "`collisions`: say who holds each record (`heldBy`); set `allowCollisions` only when the user says so.",
    "`push` says the plan changed: run `plan_push` again and show the new plan before pushing.",
    "`notCaptured` is above 0: tell the user which records to add to the update set on the instance.",
  ],
  output:
    "The update sets (names and links), the records written, and what is left: pull, integrate, and test on the instance.",
  stopAndAsk:
    "Always before `push`: the user approves the plan you showed. Also whenever there are `collisions`.",
  never: [
    "Never push without the user's approval of the plan shown, or with a plan id you did not show.",
    "Never write to the instance any other way (REST calls, background scripts).",
  ],
  prompt: { name: "deliver", description: "Plan and push changes to the development instance" },
};
