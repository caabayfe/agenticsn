import { mirrorRule, write } from "./fixtures-mirror";
import type { FixtureContext } from "./types";

export {
  CANARY,
  INJECTED_INCLUDE,
  injectedInclude,
  MIRROR_ONLY_RULE,
  mirrorOnlyRule,
} from "./fixtures-mirror";

// What the 2.x scenarios add to the slot (ADR-0031): one small Fluent project of its own scope,
// so it cannot collide with whatever the source workspace holds, and a few mirror records.
// Everything here is fictional; the names start with "Eval" so a transcript shows where a
// record came from.

export const PROJECT = "source/x_snag_eval";
const SCOPE_ID = "6d1f0a2b3c4d4e5f8a9b0c1d2e3f4a5b";

// The business rule the fixture holds as adopted source, and as a mirror record.
export const ADOPTED_RULE = {
  sysId: "7c0e1d2f3a4b4c5d8e9f0a1b2c3d4e5f",
  name: "Eval: note reopened incidents",
  script: `${PROJECT}/src/server/reopen-note.js`,
} as const;
const ruleScript = (note: string) => [
  "(function executeRule(current, previous /*null when async*/) {",
  `    current.work_notes = ${note};`,
  "})(current, previous);",
];

// The key registry as fluent-keys writes it for these records. It must name exactly what the
// project builds, or validate reports SN-MNT-010: the user's work in progress rewrites it, as
// their own fluent-keys run would have.
type Key = readonly [sysId: string, table: string];
const RULE_KEY: Key = [ADOPTED_RULE.sysId, "sys_script"];

async function writeKeys(workspace: string, entries: readonly Key[]): Promise<void> {
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : 1));
  await write(workspace, `${PROJECT}/src/fluent/generated/keys.ts`, [
    "import '@servicenow/sdk/global'",
    "",
    "declare global {",
    "    namespace Now {",
    "        namespace Internal {",
    "            interface Keys extends KeysRegistry {",
    "                explicit: {",
    ...sorted.flatMap(([id, table]) => [
      `                    '${id}': {`,
      `                        table: '${table}'`,
      `                        id: '${id}'`,
      "                    }",
    ]),
    "                }",
    "            }",
    "        }",
    "    }",
    "}",
  ]);
}

// The project as adopt and a first push would have left it: source, keys and a ledger entry.
async function project(workspace: string, { instance }: FixtureContext): Promise<void> {
  await write(workspace, `${PROJECT}/now.config.json`, [
    "{",
    '    "scope": "x_snag_eval",',
    `    "scopeId": "${SCOPE_ID}",`,
    '    "name": "Eval fixture",',
    '    "type": "configuration"',
    "}",
  ]);
  await write(workspace, `${PROJECT}/package.json`, [
    "{",
    '    "name": "x-snag-eval",',
    '    "version": "0.0.1",',
    '    "private": true,',
    '    "devDependencies": {',
    '        "@servicenow/sdk": "4.14.3"',
    "    }",
    "}",
  ]);
  await write(workspace, `${PROJECT}/.gitignore`, ["node_modules/", "dist/", ".now/"]);
  await write(workspace, `${PROJECT}/src/fluent/reopen-note.now.ts`, [
    "import { BusinessRule } from '@servicenow/sdk/core'",
    "",
    "BusinessRule({",
    `    $id: '${ADOPTED_RULE.sysId}',`,
    `    name: '${ADOPTED_RULE.name}',`,
    "    table: 'incident',",
    "    when: 'before',",
    "    action: ['update'],",
    "    order: 200,",
    "    active: true,",
    "    description: 'Adds a work note when a resolved incident goes back to In Progress.',",
    "    filterCondition: 'stateCHANGESFROM6^state=2^EQ',",
    "    script: Now.include('../server/reopen-note.js'),",
    "})",
  ]);
  await write(workspace, ADOPTED_RULE.script, ruleScript("'Reopened'"));
  await writeKeys(workspace, [RULE_KEY]);
  await write(workspace, `${PROJECT}/snagentic.ledger.yaml`, [
    "# Written by snagentic: what each development instance held when it last agreed with this",
    "# project's source (ADR-0033). Never edit it by hand.",
    `${instance}:`,
    `  sys_script_${ADOPTED_RULE.sysId}:`,
    "    build: 0f1e2d3c4b5a69788796a5b4c3d2e1f0",
    "    instance: 0|2026-11-02 09:15:00",
  ]);
}

// A record the workspace holds as source and the mirror holds as the instance's copy: the
// agent finds both, and only the source may be edited.
export async function adoptedProject(workspace: string, context: FixtureContext): Promise<void> {
  await project(workspace, context);
  await mirrorRule(workspace, context.instance, {
    scope: "x_snag_eval",
    slug: "eval-note-reopened-incidents",
    sysId: ADOPTED_RULE.sysId,
    name: ADOPTED_RULE.name,
    insert: false,
    filter: "stateCHANGESFROM6^state=2^EQ",
    script: ruleScript("'Reopened'"),
  });
}

async function scriptInclude(
  workspace: string,
  file: string,
  include: { readonly sysId: string; readonly name: string; readonly description: string },
  script: readonly string[],
): Promise<void> {
  await write(workspace, `${PROJECT}/src/fluent/${file}.now.ts`, [
    "import { ScriptInclude } from '@servicenow/sdk/core'",
    "",
    "ScriptInclude({",
    `    $id: '${include.sysId}',`,
    `    name: '${include.name}',`,
    `    apiName: 'x_snag_eval.${include.name}',`,
    `    description: '${include.description}',`,
    `    script: Now.include('../server/${file}.js'),`,
    "})",
  ]);
  await write(workspace, `${PROJECT}/src/server/${file}.js`, script);
  await writeKeys(workspace, [RULE_KEY, [include.sysId, "sys_script_include"]]);
}

// The user's work in progress for the review: a script include with problems validate finds.
export async function riskyChange(workspace: string): Promise<void> {
  await scriptInclude(
    workspace,
    "incident-cleanup",
    {
      sysId: "5e1f0c2a9b8d4e7f8a6b5c4d3e2f1a0b",
      name: "IncidentCleanup",
      description: "Reassigns the active incidents a filter selects.",
    },
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
    ],
  );
}

// Work in progress that validate blocks for one reason, with a fix that keeps the behavior:
// the payload is JSON, so JSON.parse reads it.
export async function blockedChange(workspace: string): Promise<void> {
  await scriptInclude(
    workspace,
    "payload-reader",
    {
      sysId: "4a7b8c9d0e1f4a2b8c3d4e5f6a7b8c9d",
      name: "EvalPayloadReader",
      description: "Reads the JSON payload an integration stores on an incident.",
    },
    [
      "var EvalPayloadReader = Class.create();",
      "EvalPayloadReader.prototype = {",
      "    initialize: function () {},",
      "    // The payload is a JSON object, stored as text.",
      "    read: function (text) {",
      "        return eval('(' + text + ')');",
      "    },",
      "    type: 'EvalPayloadReader'",
      "};",
    ],
  );
}

// Work in progress that is valid and ready to deliver.
export async function readyChange(workspace: string): Promise<void> {
  await write(
    workspace,
    ADOPTED_RULE.script,
    ruleScript("'Reopened by ' + gs.getUserDisplayName()"),
  );
}
