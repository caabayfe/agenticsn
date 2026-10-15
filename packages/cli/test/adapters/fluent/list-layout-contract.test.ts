import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ListLayout, listLayoutXml, listUpdateName } from "@snagentic/core";
import { loadFluentRuntime } from "../../../src/adapters/fluent/fluent-runtime-loader";

// ADR-0029, item 2: snagentic writes a list layout's update itself, in the form the embedded
// SDK's List() builds. This builds the same lists with the SDK, ids pinned through its key
// registry, and requires the same bytes: an SDK upgrade that changes the form fails here.

const BUILD_TIMEOUT = 60_000;
const SCOPE = { name: "x_acme_app", sysId: "24585a3c3484e481f8994b3c68c5d588" };
const TABLE = "x_acme_app_task";
const MOBILE = { sysId: "5ac86a6e7a3b4a94800c6236b74246a8", name: "mobile" };

const column = (sysId: string, element: string, position: number, sum: boolean) => ({
  sysId,
  element,
  position: String(position),
  sum: String(sum),
  maxValue: "false",
  minValue: "false",
  averageValue: "false",
});

const LAYOUTS: ListLayout[] = [
  {
    sysId: "c7ca7c78a96a4757bf140506df7e205f",
    table: TABLE,
    view: { sysId: "Default view", name: "" },
    domain: "global",
    columns: [
      column("04b2dd54bae443f0bc24aeebb6072da7", "number", 0, true),
      column("83c3420ae55e4179afa50acfa566fe7f", "state", 1, false),
    ],
  },
  {
    sysId: "393b005ea39845328cef9e91cab4ca08",
    table: TABLE,
    view: MOBILE,
    domain: "global",
    columns: [column("0d9b2391865748649269d01877dbe36d", "short_description", 0, false)],
  },
];

const listKey = (layout: ListLayout) => {
  const view =
    layout.view.sysId === "Default view"
      ? "{ id: 'Default view', key: { name: 'NULL' } }"
      : `{ id: '${layout.view.sysId}', key: { name: '${layout.view.name}' } }`;
  return `{ name: '${layout.table}', view: ${view}, sys_domain: 'global', element: 'NULL', relationship: 'NULL', parent: 'NULL' }`;
};

// The SDK's key registry, pinning the view's, the list's and each column's sys_id.
function keysFile(layouts: readonly ListLayout[]): string {
  const entries = layouts.flatMap((layout) => [
    ...(layout.view.sysId === "Default view"
      ? []
      : [
          `{ table: 'sys_ui_view', id: '${layout.view.sysId}', key: { name: '${layout.view.name}' } }`,
        ]),
    `{ table: 'sys_ui_list', id: '${layout.sysId}', key: ${listKey(layout)} }`,
    ...layout.columns.map(
      (c) =>
        `{ table: 'sys_ui_list_element', id: '${c.sysId}', key: { list_id: { id: '${layout.sysId}', key: ${listKey(layout)} }, element: '${c.element}' } }`,
    ),
  ]);
  return `import '@servicenow/sdk/global'\ndeclare global { namespace Now { namespace Internal { interface Keys extends KeysRegistry { composite: [${entries.join(", ")}] } } } }\n`;
}

const source = (layout: ListLayout) => {
  const view = layout.view.sysId === "Default view" ? "default_view" : `'${layout.view.name}'`;
  const columns = layout.columns.map(
    (c) =>
      `{ element: '${c.element}', position: ${c.position}, minValue: false, maxValue: false, averageValue: false, sum: ${c.sum} }`,
  );
  return `List({ table: '${layout.table}', view: ${view}, columns: [${columns.join(", ")}] })`;
};

function project(layouts: readonly ListLayout[]): string {
  const dir = join(mkdtempSync(join(tmpdir(), "list-contract-")), "project");
  mkdirSync(join(dir, "src", "fluent", "generated"), { recursive: true });
  const config = { scope: SCOPE.name, scopeId: SCOPE.sysId, type: "configuration" };
  writeFileSync(join(dir, "now.config.json"), JSON.stringify(config));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "lists", version: "0.0.1" }));
  writeFileSync(
    join(dir, "src", "fluent", "lists.now.ts"),
    `import { default_view, List } from '@servicenow/sdk/core'\n${layouts.map(source).join("\n")}\n`,
  );
  writeFileSync(join(dir, "src", "fluent", "generated", "keys.ts"), keysFile(layouts));
  return dir;
}

describe("list layout update, against the embedded SDK (ADR-0029)", () => {
  it(
    "writes what the SDK's List() builds, byte for byte, under the name the SDK gives it",
    async () => {
      const dir = project(LAYOUTS);
      const outcome = await (await loadFluentRuntime()).build(dir);
      expect(outcome.success).toBe(true);
      for (const layout of LAYOUTS) {
        const built = readFileSync(
          join(dir, "dist", "app", `${listUpdateName(layout)}.xml`),
          "utf8",
        );
        expect(listLayoutXml(layout, SCOPE)).toBe(built.trimEnd());
      }
    },
    BUILD_TIMEOUT,
  );
});
