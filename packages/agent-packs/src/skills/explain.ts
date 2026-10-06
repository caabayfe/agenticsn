import type { Skill } from "../skill";

export const EXPLAIN: Skill = {
  name: "servicenow-explain",
  description:
    "Explain how the ServiceNow instance behaves: why a field changes, what runs when a record is saved, where something is defined, what uses a script include. Use for questions, not changes.",
  when: "Questions about existing behavior. For a change, use servicenow-design.",
  steps: [
    "If you do not know where it lives: `find` with the user's words (`code` true to search inside scripts); pick the best match.",
    "`describe` the table or the record. Read `behavior` in execution order: before rules, the database write, after rules, async work, notifications.",
    "Read the scripts the result points to (`path`, `files`, `line`), not the whole folder.",
    "When a script calls others, `describe` those records; `usedBy` shows who calls a record.",
    "Answer with the sequence of what runs, each step with its path.",
  ],
  decide: [
    "`stale` is true: tell the user and offer `pull` before answering.",
    "More than one candidate from `find`: say which you chose and why.",
    "`notCovered` names what you are asked about: say the mirror cannot show it yet.",
  ],
  output: "A numbered sequence (when, what, path), then the direct answer.",
  stopAndAsk:
    "If the behavior depends on data you cannot see (a property value, a user's roles), say what would decide it instead of guessing.",
  never: [
    "Never answer from general ServiceNow knowledge when the mirror can show the actual records.",
  ],
  prompt: { name: "explain", description: "Explain how the instance behaves, from its records" },
};
