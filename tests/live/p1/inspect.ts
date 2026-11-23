import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { decodeCapture } from "../../../packages/cli/src/adapters/fluent/capture-decoder";
import { SdkToolchain } from "../../../packages/cli/src/adapters/fluent/fluent-toolchain";
import { FLUENT_WORKER_COMMAND } from "../../../packages/cli/src/adapters/fluent/worker-protocol";
import { workerRuntime } from "../../../packages/cli/src/adapters/fluent/worker-runtime";
import { osSandbox } from "../../../packages/cli/src/adapters/fluent/worker-sandbox";
import { captureReferences } from "../../../packages/core/src/delivery/application/capture-references";
import {
  capturedContentAgrees,
  compareUnit,
  KeysetPager,
  redactSecrets,
  SESSION_USER,
  TableName,
} from "../../../packages/core/src/index";
import { liveClient } from "../verify/live-connection";

const [root = ""] = process.argv.slice(2);
if (!root) throw new Error("acceptance workspace required");
const output = join(root, "acceptance");
const client = await liveClient("pdi11", root);
const signal = AbortSignal.timeout(60000);
const runtime = workerRuntime({
  sdkVersion: "4.14.2",
  command: [resolve(import.meta.dir, "../../../dist/snagentic"), FLUENT_WORKER_COMMAND],
  sandbox: osSandbox(),
  warn: (line) => console.error(line),
});
const built = await new SdkToolchain(root, async () => runtime).build({
  path: "source/global",
  scope: "global",
  scopeId: "global",
});
if (!built.ok) throw new Error(built.message);
mkdirSync(join(output, "built"), { recursive: true });
mkdirSync(join(output, "captured"), { recursive: true });
for (const [file, xml] of built.files) writeFileSync(join(output, "built", file), xml);

async function list(table: string, base: string, fields: readonly string[]) {
  const rows = [];
  for await (const row of new KeysetPager(client).rows(
    {
      kind: "snapshot",
      table: TableName.parse(table),
      base,
      fields: [...new Set(["sys_id", ...fields])],
    },
    signal,
  ))
    rows.push(row);
  return rows;
}

const names = built.units.map((unit) => unit.updateName);
const updates = await list("sys_update_xml", `nameIN${names.join(",")}`, [
  "sys_id",
  "name",
  "update_set",
  "payload",
  "sys_updated_on",
]);
const reports = await Promise.all(
  updates.map(async (row) => {
    const name = row["name"] ?? "";
    const wanted = built.units.find((unit) => unit.updateName === name);
    const payload = row["payload"] ?? "";
    const content = decodeCapture(name, payload);
    writeFileSync(
      join(output, "captured", `${name}-${row["update_set"]}.xml`),
      redactSecrets(payload),
    );
    return {
      name,
      updateSet: row["update_set"],
      bytes: payload.length,
      decoded: content !== null,
      published: content?.published,
      agrees:
        wanted !== undefined &&
        content !== null &&
        capturedContentAgrees(
          wanted,
          content.unit,
          await captureReferences(client, wanted, content.unit, signal),
        ),
      builtTables:
        wanted === undefined ? [] : [...new Set(wanted.children.map((child) => child.table))],
      capturedTables:
        content === null ? [] : [...new Set(content.unit.children.map((child) => child.table))],
      missingHeadFields:
        wanted === undefined || content === null
          ? []
          : Object.keys(wanted.head.fields).filter(
              (field) => content.unit.head.fields[field] === undefined,
            ),
      headDifferences:
        wanted === undefined || content === null
          ? []
          : compareUnit(
              { ...wanted, children: [] },
              { head: content.unit.head.fields, children: [], version: "", foreignRows: 0 },
            ).map((difference) =>
              difference.kind === "field" ? difference.field : difference.table,
            ),
    };
  }),
);
const live = [];
for (const unit of built.units) {
  const rows = await client.query(
    {
      table: TableName.parse(unit.head.table),
      query: `sys_id=${unit.head.sysId}`,
      fields: [
        "sys_id",
        "name",
        "status",
        "state",
        "active",
        "master_snapshot",
        "latest_snapshot",
        "sys_mod_count",
        "sys_updated_on",
      ],
      limit: 1,
    },
    signal,
  );
  live.push({ unit: unit.updateName, record: rows[0] ?? null });
}
const user =
  (
    await client.query(
      {
        table: TableName.parse("sys_user"),
        query: `sys_id=${SESSION_USER}`,
        fields: ["sys_id"],
        limit: 1,
      },
      signal,
    )
  )[0]?.["sys_id"] ?? "";
const preferences = await list(
  "sys_user_preference",
  `user=${user}^nameINapps.current_app,sys_update_set`,
  ["name", "value"],
);
const before: readonly Record<string, string>[] = JSON.parse(
  readFileSync(join(output, "preferences-before.json"), "utf8"),
);
const restored = before.every(
  (row) => preferences.find((after) => after["name"] === row["name"])?.["value"] === row["value"],
);
const result = { reports, live, preferencesRestored: restored };
writeFileSync(join(output, "inspection.json"), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
