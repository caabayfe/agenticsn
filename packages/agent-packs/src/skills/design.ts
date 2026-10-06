import type { Skill } from "../skill";

export const DESIGN: Skill = {
  name: "servicenow-design",
  description:
    'Design a ServiceNow change before any edit: add or change a field, a business rule, a notification, an approval, an assignment, an integration, form behavior, or "make X happen when Y". Use first for every change request; it ends with a design the user approved.',
  when: [
    "Any request to add or change behavior on the instance, before editing files.",
    "For questions about existing behavior use servicenow-explain; for an approved design,",
    "servicenow-build.",
  ].join("\n"),
  steps: [
    "`status`: if `phase` is not `integrated`, or the last pull is old, tell the user and offer `pull`.",
    "`describe` each table the request touches (`target`: the table). Note its `behavior` in execution order.",
    "`advise` with `intent` (the user's words), `tables`, and `phase` design.",
    "Present the `ladder`: the options whose `fit` is likely or possible, least custom first, each with its `evidence`.",
    "`describe` the `related` records in `facts` that the chosen option would interact with.",
    "Fill in the `designRecord` with the chosen option and present it to the user.",
  ],
  decide: [
    "`stale` is true: offer `pull` before designing.",
    "`intents` is empty: ask what should happen, when, and to which records; then `advise` again.",
    "Choose a `customization` of script only when no configuration or low-code option fits, and say why.",
    "A `related` record already does most of it: propose changing or reusing it instead of adding one.",
  ],
  output: [
    "The design record: the requirement, the option chosen and why less custom ones do not fit,",
    "the records to create or change (paths), the existing behavior it interacts with (from",
    "`describe`), and the `rules` that will apply.",
  ].join("\n"),
  stopAndAsk:
    "Always before editing: the user approves the design. Also when the trigger, the audience or the records are ambiguous.",
  never: [
    "Never edit files in this workflow.",
    "Never pick a script when a configuration option fits.",
    "Never plan to modify an out-of-box record you could extend or copy.",
  ],
  prompt: { name: "design", description: "Design a ServiceNow change before editing anything" },
};
