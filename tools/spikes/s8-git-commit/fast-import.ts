// Spike S8 (throwaway): commit a full mirror with `git fast-import` instead of writing a
// work tree and running `git add`.
//   bun tools/spikes/s8-git-commit/fast-import.ts <scratch repo dir>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { toYaml } from "../../../packages/cli/src/adapters/yaml/own-style";
import {
  artifactFromRow,
  Catalog,
  DEFAULT_REDACTION,
  renderRecord,
} from "../../../packages/core/src/index";

const repo = process.argv[2] ?? "";
const V1 = "/Users/fernando.caamano/dev/personal/agenticsn/snagentic/.snagentic/pdi";
const raw = JSON.parse(readFileSync(`${V1}/catalog.json`, "utf8"));
const catalog = new Catalog({
  parents: raw.parents,
  scopes: raw.scopes,
  typedFields: raw.typed_fields,
});
const encoder = new TextEncoder();

function readRow(dir: string): Record<string, string> {
  const meta = parse(readFileSync(join(dir, "_meta.yaml"), "utf8"));
  const plain = parse(readFileSync(join(dir, "record.yaml"), "utf8"), { schema: "failsafe" }) ?? {};
  const row: Record<string, string> = {};
  for (const [k, v] of Object.entries(meta)) if (k.startsWith("sys_")) row[k] = String(v);
  for (const [k, v] of Object.entries(plain)) row[k] = String(v);
  for (const [f, n] of Object.entries((meta.files ?? {}) as Record<string, string>))
    row[f] = readFileSync(join(dir, n), "utf8");
  return row;
}

function* rows(dir: string): Generator<Record<string, string>> {
  const entries = readdirSync(dir, { withFileTypes: true });
  if (entries.some((e) => e.name === "_meta.yaml")) {
    yield readRow(dir);
    return;
  }
  for (const e of entries)
    if (e.isDirectory() && e.name !== "_children") yield* rows(join(dir, e.name));
}

const all = [...rows(`${V1}/mirror-tree/instances/pdi/metadata`)];
console.log(`loaded ${all.length} records (input only, not measured)`);
await Bun.spawn(["git", "init", "-q", "-b", "main", repo]).exited;
const started = performance.now();
const git = Bun.spawn(["git", "fast-import", "--quiet", "--done"], { cwd: repo, stdin: "pipe" });
const write = (text: string | Uint8Array) => git.stdin.write(text);
const paths: [string, number][] = [];
let mark = 0;
const blob = (content: string) => {
  const bytes = encoder.encode(content);
  mark += 1;
  write(`blob\nmark :${mark}\ndata ${bytes.length}\n`);
  write(bytes);
  write("\n");
  return mark;
};
for (const row of all) {
  const rendered = renderRecord(artifactFromRow(row, catalog, DEFAULT_REDACTION), catalog);
  const prefix = "instances/pdi/metadata/";
  paths.push([`${prefix}${rendered.base}.yaml`, blob(toYaml(rendered.document))]);
  for (const file of rendered.files) paths.push([`${prefix}${file.path}`, blob(file.content)]);
}
const message = encoder.encode("snagentic pull pdi: full\n");
write(
  `commit refs/heads/servicenow-remote/pdi\ncommitter snagentic <snagentic@localhost> ${Math.floor(Date.now() / 1000)} +0000\ndata ${message.length}\n`,
);
write(message);
write("deleteall\n");
for (const [path, m] of paths) write(`M 100644 :${m} ${path}\n`);
write("\ndone\n");
await git.stdin.end();
await git.exited;
const importSeconds = (performance.now() - started) / 1000;
const size = (
  await new Response(Bun.spawn(["du", "-sk", ".git"], { cwd: repo }).stdout).text()
).split("\t")[0];
const t2 = performance.now();
await Bun.spawn(
  ["git", "-c", "feature.manyFiles=true", "checkout", "-q", "servicenow-remote/pdi"],
  { cwd: repo },
).exited;
const checkoutSeconds = (performance.now() - t2) / 1000;
const t3 = performance.now();
await Bun.spawn(["git", "status", "--porcelain"], { cwd: repo, stdout: "ignore" }).exited;
console.log(
  JSON.stringify({
    records: all.length,
    files: paths.length,
    fastImportSeconds: +importSeconds.toFixed(1),
    gitDirMb: Math.round(Number(size) / 1024),
    firstCheckoutSeconds: +checkoutSeconds.toFixed(1),
    statusAfterCheckoutSeconds: +((performance.now() - t3) / 1000).toFixed(1),
  }),
);
