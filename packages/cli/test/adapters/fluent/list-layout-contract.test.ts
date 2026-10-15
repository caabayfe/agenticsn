import { describe, expect, it } from "bun:test";
import { type ListLayout, listLayoutXml, listUpdateName } from "@snagentic/core";
import {
  buildWithSdk,
  keyEntry,
  SCOPE,
  SDK_BUILD_TIMEOUT,
  viewKey,
} from "../../support/sdk-contract";

// ADR-0029, item 2: snagentic writes a list layout's update itself, in the form the embedded
// SDK's List() builds. This builds the same lists with the SDK, ids pinned through its key
// registry, and requires the same bytes: an SDK upgrade that changes the form fails here.

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

const listKey = (layout: ListLayout) =>
  `{ name: '${layout.table}', view: ${viewKey(layout.view)}, sys_domain: 'global', element: 'NULL', relationship: 'NULL', parent: 'NULL' }`;

// The view's, the list's and each column's sys_id.
const keys = LAYOUTS.flatMap((layout) => [
  ...(layout.view.sysId === "Default view"
    ? []
    : [keyEntry("sys_ui_view", layout.view.sysId, `{ name: '${layout.view.name}' }`)]),
  keyEntry("sys_ui_list", layout.sysId, listKey(layout)),
  ...layout.columns.map((c) =>
    keyEntry(
      "sys_ui_list_element",
      c.sysId,
      `{ list_id: { id: '${layout.sysId}', key: ${listKey(layout)} }, element: '${c.element}' }`,
    ),
  ),
]);

const source = (layout: ListLayout) => {
  const view = layout.view.sysId === "Default view" ? "default_view" : `'${layout.view.name}'`;
  const columns = layout.columns.map(
    (c) =>
      `{ element: '${c.element}', position: ${c.position}, minValue: false, maxValue: false, averageValue: false, sum: ${c.sum} }`,
  );
  return `List({ table: '${layout.table}', view: ${view}, columns: [${columns.join(", ")}] })`;
};

describe("list layout update, against the embedded SDK (ADR-0029)", () => {
  it(
    "writes what the SDK's List() builds, byte for byte, under the name the SDK gives it",
    async () => {
      const { outcome, built } = await buildWithSdk(
        "import { default_view, List } from '@servicenow/sdk/core'",
        LAYOUTS.map(source).join("\n"),
        keys,
      );
      expect(outcome.success).toBe(true);
      for (const layout of LAYOUTS) {
        expect(listLayoutXml(layout, SCOPE)).toBe(built(listUpdateName(layout).toLowerCase()));
      }
    },
    SDK_BUILD_TIMEOUT,
  );
});
