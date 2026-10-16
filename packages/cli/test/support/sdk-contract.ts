import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFluentRuntime } from "../../src/adapters/fluent/fluent-runtime-loader";

// Contract tests for the updates snagentic writes in the SDK's form (ADR-0029, ADR-0030): a Fluent
// configuration project built with the embedded SDK, its records' sys_ids pinned through the SDK's
// key registry (src/fluent/generated/keys.ts).

export const SDK_BUILD_TIMEOUT = 60_000;
export const SCOPE = { name: "x_acme_app", sysId: "24585a3c3484e481f8994b3c68c5d588" };

// One entry of the key registry: a record's table, its sys_id and its coalesce key, as TypeScript.
export const keyEntry = (table: string, id: string, key: string) =>
  `{ table: '${table}', id: '${id}', key: ${key} }`;

export const viewKey = (view: { readonly sysId: string; readonly name: string }) =>
  view.sysId === "Default view"
    ? "{ id: 'Default view', key: { name: 'NULL' } }"
    : `{ id: '${view.sysId}', key: { name: '${view.name}' } }`;

// An explicit key (Now.ID['<name>']) pinned to a sys_id.
export const explicitKey = (name: string, table: string, id: string) =>
  `${name}: { table: '${table}', id: '${id}' }`;

// Builds `source` (Fluent statements after `imports`) with `keys` (composite) and `explicit`
// pinned; returns a reader of the built update files by name.
export async function buildWithSdk(
  imports: string,
  source: string,
  keys: readonly string[],
  explicit: readonly string[] = [],
) {
  const dir = join(mkdtempSync(join(tmpdir(), "sdk-contract-")), "project");
  mkdirSync(join(dir, "src", "fluent", "generated"), { recursive: true });
  const config = { scope: SCOPE.name, scopeId: SCOPE.sysId, type: "configuration" };
  writeFileSync(join(dir, "now.config.json"), JSON.stringify(config));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "contract", version: "0.0.1" }));
  writeFileSync(join(dir, "src", "fluent", "records.now.ts"), `${imports}\n${source}\n`);
  writeFileSync(
    join(dir, "src", "fluent", "generated", "keys.ts"),
    `import '@servicenow/sdk/global'\ndeclare global { namespace Now { namespace Internal { interface Keys extends KeysRegistry { explicit: { ${explicit.join(", ")} }, composite: [${keys.join(", ")}] } } } }\n`,
  );
  const outcome = await (await loadFluentRuntime()).build(dir);
  return {
    outcome,
    built: (name: string) =>
      readFileSync(join(dir, "dist", "app", `${name}.xml`), "utf8").trimEnd(),
  };
}
