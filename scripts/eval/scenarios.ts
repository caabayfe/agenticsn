import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  asksApproval,
  beforeEditing,
  changedClasses,
  changedMetadata,
  citesPaths,
  endStateValid,
  loadedSkill,
  noChanges,
  noEditsInTurn,
  replyMentions,
  stayedInBounds,
  usedTool,
  validatedAfterLastEdit,
} from "./checks";
import type { Scenario } from "./types";

// A change to review: a new script include with problems validate must find.
async function addRiskyScriptInclude(workspace: string): Promise<void> {
  const folder = join(workspace, "instances/pdi/metadata/global/sys_script_include");
  const base = join(folder, "incident-cleanup--5e1f0c2a9b8d4e7f8a6b5c4d3e2f1a0b");
  await mkdir(folder, { recursive: true });
  await writeFile(
    `${base}.yaml`,
    [
      "_meta:",
      "  scope: global",
      "  sys_class_name: sys_script_include",
      "  sys_id: 5e1f0c2a9b8d4e7f8a6b5c4d3e2f1a0b",
      "active: 'true'",
      "name: IncidentCleanup",
      "",
    ].join("\n"),
  );
  await writeFile(
    `${base}.script.js`,
    [
      "var IncidentCleanup = Class.create();",
      "IncidentCleanup.prototype = {",
      "  run: function (filter) {",
      "    var gr = new GlideRecord('incident');",
      "    gr.addEncodedQuery('active=true^' + filter);",
      "    gr.query();",
      "    while (gr.next()) {",
      "      gr.assignment_group = '8a5055c9c61122780043563ef53438e3';",
      "      gr.setWorkflow(false);",
      "      gr.update();",
      "    }",
      "    eval(filter);",
      "  },",
      "  type: 'IncidentCleanup'",
      "};",
      "",
    ].join("\n"),
  );
}

const EXPLAIN = [usedTool("describe"), citesPaths(2), noChanges(), stayedInBounds()];

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "explain-assignment",
    kind: "task",
    turns: [
      "When I save an incident, what can change its assignment group? Tell me what runs and where it is defined.",
    ],
    checks: [...EXPLAIN, loadedSkill("servicenow-explain")],
  },
  {
    id: "explain-state-on-assignment",
    kind: "task",
    turns: ["Why does an incident's state change to In Progress when someone assigns it?"],
    checks: [
      ...EXPLAIN,
      replyMentions(
        "names-the-rule",
        /incident-state-active-on-assignment|Incident State Active on Assignment/i,
      ),
    ],
  },
  {
    id: "design-notify-p1",
    kind: "task",
    turns: ["When a P1 incident is created, notify the on-call manager."],
    checks: [
      usedTool("describe"),
      usedTool("advise"),
      noEditsInTurn(0),
      asksApproval(0),
      noChanges(),
      loadedSkill("servicenow-design"),
    ],
  },
  {
    id: "build-mandatory-business-service",
    kind: "task",
    turns: [
      "Make the Business service field mandatory on the incident form when the priority is 1 - Critical.",
      "Approved. Go ahead and build it.",
    ],
    checks: [
      noEditsInTurn(0),
      asksApproval(0),
      beforeEditing(["describe", "advise"]),
      changedMetadata(),
      changedClasses(["sys_ui_policy", "sys_data_policy2"], ["sys_script_client", "sys_script"]),
      validatedAfterLastEdit(),
      endStateValid(),
      stayedInBounds(),
    ],
  },
  {
    id: "review-risky-change",
    kind: "task",
    turns: ["Review my changes before I deliver them."],
    prepare: addRiskyScriptInclude,
    checks: [
      usedTool("validate"),
      replyMentions("cites-eval-rule", /SN-SEC-001/),
      replyMentions("cites-the-file", /incident-cleanup/),
      stayedInBounds(),
      loadedSkill("servicenow-review"),
    ],
  },
  ...(
    [
      [
        "trigger-explain-why",
        "Why does the assignment group change when I save an incident?",
        "servicenow-explain",
      ],
      [
        "trigger-explain-where",
        "Where is the incident number prefix defined?",
        "servicenow-explain",
      ],
      [
        "trigger-design-field",
        "Add a 'Customer impact' choice field to the incident form.",
        "servicenow-design",
      ],
      ["trigger-review", "Review my changes before I deliver them.", "servicenow-review"],
      ["trigger-none-python", "Write a Python script that counts the rows of a CSV file.", null],
      ["trigger-none-js", "What is the difference between let and var in JavaScript?", null],
    ] as const
  ).map(
    ([id, turn, skill]): Scenario => ({
      id,
      kind: "trigger",
      turns: [turn],
      checks: [loadedSkill(skill)],
    }),
  ),
];
