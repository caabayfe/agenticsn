// Spike S7 (throwaway): which on-disk layout should a workspace use?
//   bun tools/spikes/s7-data-layout/compare-layouts.ts <v1 metadata dir> <scratch dir> <out.json>
// Streams every v1 record into three layouts (own YAML style) and measures each.
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";

const [source, scratch, out] = process.argv.slice(2);
if (source === undefined || scratch === undefined || out === undefined) {
  console.error("usage: compare-layouts.ts <v1 metadata dir> <scratch dir> <out.json>");
  process.exit(2);
}

const STYLE = {
  sortMapEntries: true,
  lineWidth: 0,
  singleQuote: true,
  blockQuote: "literal",
} as const;
type Layout = "A-v1" | "B-merged-meta" | "C-flat";
const LAYOUTS: readonly Layout[] = ["A-v1", "B-merged-meta", "C-flat"];

interface V1Record {
  readonly classDir: string; // <scope>/<class>
  readonly leaf: string; // <slug>--<sys_id>
  readonly meta: Record<string, unknown>;
  readonly plain: Record<string, string>;
  readonly files: readonly {
    readonly field: string;
    readonly name: string;
    readonly content: string;
  }[];
  readonly children: readonly { readonly table: string; readonly content: string }[];
}

async function* recordDirectories(directory: string): AsyncGenerator<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => entry.name === "_meta.yaml")) {
    yield directory;
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== "_children") {
      yield* recordDirectories(join(directory, entry.name));
    }
  }
}

async function readChildren(directory: string): Promise<V1Record["children"]> {
  const childrenDir = join(directory, "_children");
  const names = await readdir(childrenDir).catch(() => [] as string[]);
  return Promise.all(
    names.map(async (name) => ({
      table: name.replace(/\.yaml$/, ""),
      content: await readFile(join(childrenDir, name), "utf8"),
    })),
  );
}

async function readV1(directory: string): Promise<V1Record> {
  const meta = (parse(await readFile(join(directory, "_meta.yaml"), "utf8")) ?? {}) as Record<
    string,
    unknown
  >;
  const plainText = await readFile(join(directory, "record.yaml"), "utf8").catch(() => "{}");
  const plain = (parse(plainText, { schema: "failsafe" }) ?? {}) as Record<string, string>;
  const fileMap = (meta["files"] ?? {}) as Record<string, string>;
  const files = await Promise.all(
    Object.entries(fileMap).map(async ([field, name]) => ({
      field,
      name,
      content: await readFile(join(directory, name), "utf8"),
    })),
  );
  const relative = directory.slice((source ?? "").length + 1).split("/");
  return {
    classDir: relative.slice(0, -1).join("/"),
    leaf: relative.at(-1) ?? "",
    meta,
    plain,
    files,
    children: await readChildren(directory),
  };
}

async function writeA(root: string, record: V1Record): Promise<void> {
  const directory = join(root, record.classDir, record.leaf);
  await mkdir(join(directory), { recursive: true });
  await writeFile(join(directory, "_meta.yaml"), stringify(record.meta, STYLE));
  await writeFile(join(directory, "record.yaml"), stringify(record.plain, STYLE));
  await Promise.all(
    record.files.map((file) => writeFile(join(directory, file.name), file.content)),
  );
  await writeChildren(join(directory, "_children"), record, (table) => `${table}.yaml`);
}

async function writeB(root: string, record: V1Record): Promise<void> {
  const directory = join(root, record.classDir, record.leaf);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "record.yaml"),
    stringify({ _meta: record.meta, ...record.plain }, STYLE),
  );
  await Promise.all(
    record.files.map((file) => writeFile(join(directory, file.name), file.content)),
  );
  await writeChildren(join(directory, "_children"), record, (table) => `${table}.yaml`);
}

async function writeC(root: string, record: V1Record): Promise<void> {
  const directory = join(root, record.classDir);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${record.leaf}.yaml`),
    stringify({ _meta: record.meta, ...record.plain }, STYLE),
  );
  await Promise.all(
    record.files.map((file) =>
      writeFile(join(directory, `${record.leaf}.${file.name}`), file.content),
    ),
  );
  await writeChildren(directory, record, (table) => `${record.leaf}.children.${table}.yaml`);
}

async function writeChildren(
  directory: string,
  record: V1Record,
  name: (table: string) => string,
): Promise<void> {
  if (record.children.length === 0) {
    return;
  }
  await mkdir(directory, { recursive: true });
  await Promise.all(
    record.children.map((child) => writeFile(join(directory, name(child.table)), child.content)),
  );
}

const WRITERS: Record<Layout, (root: string, record: V1Record) => Promise<void>> = {
  "A-v1": writeA,
  "B-merged-meta": writeB,
  "C-flat": writeC,
};

async function shell(command: string, cwd: string): Promise<{ ms: number; out: string }> {
  const started = performance.now();
  const child = Bun.spawn(["sh", "-c", command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const text = await new Response(child.stdout).text();
  await child.exited;
  return { ms: Math.round(performance.now() - started), out: text.trim() };
}

async function convert(
  layout: Layout,
  root: string,
): Promise<{ records: number; writeMs: number; readMs: number }> {
  let records = 0;
  let readMs = 0;
  let writeMs = 0;
  for await (const directory of recordDirectories(source ?? "")) {
    const readStarted = performance.now();
    const record = await readV1(directory);
    readMs += performance.now() - readStarted;
    const writeStarted = performance.now();
    await WRITERS[layout](root, record);
    writeMs += performance.now() - writeStarted;
    records += 1;
  }
  return { records, writeMs: Math.round(writeMs), readMs: Math.round(readMs) };
}

const GIT = "git -c user.name=s7 -c user.email=s7@example.invalid";

async function measureGit(repository: string): Promise<Record<string, number | string>> {
  await shell(
    "git init -q -b main && git config feature.manyFiles true && git config core.untrackedCache true && git config core.fsmonitor true",
    repository,
  );
  const add = await shell("git add -A", repository);
  const commit = await shell(`${GIT} commit -q -m initial`, repository);
  const statusCold = await shell("git status --porcelain | wc -l", repository);
  const statusWarm = await shell("git status --porcelain | wc -l", repository);
  return {
    gitAddMs: add.ms,
    gitCommitMs: commit.ms,
    statusColdMs: statusCold.ms,
    statusWarmMs: statusWarm.ms,
    gitDirKb: (await shell("du -sk .git | cut -f1", repository)).out,
  };
}

async function measureChange(
  repository: string,
  yamlFiles: readonly string[],
): Promise<Record<string, number>> {
  const step = Math.max(1, Math.floor(yamlFiles.length / 100));
  const touched = yamlFiles.filter((_, index) => index % step === 0).slice(0, 100);
  for (const file of touched) {
    await writeFile(
      join(repository, file),
      `${await readFile(join(repository, file), "utf8")}u_touched: 'x'\n`,
    );
  }
  const status = await shell("git status --porcelain | wc -l", repository);
  const add = await shell("git add -A", repository);
  const commit = await shell(`${GIT} commit -q -m touch`, repository);
  return {
    changedRecords: touched.length,
    statusAfterChangeMs: status.ms,
    addAfterChangeMs: add.ms,
    commitAfterChangeMs: commit.ms,
  };
}

async function recordYamlFiles(repository: string, layout: Layout): Promise<string[]> {
  const pattern =
    layout === "C-flat"
      ? "find metadata -name '*.yaml' ! -name '*.children.*'"
      : "find metadata -name record.yaml";
  return (await shell(`${pattern} | sort`, repository)).out.split("\n").filter(Boolean);
}

async function measureLayout(layout: Layout): Promise<Record<string, unknown>> {
  const repository = join(scratch ?? "", layout);
  await rm(repository, { recursive: true, force: true });
  const root = join(repository, "metadata");
  await mkdir(root, { recursive: true });
  console.log(`[${layout}] converting…`);
  const conversion = await convert(layout, root);
  const files = Number((await shell("find metadata -type f | wc -l", repository)).out);
  const directories = Number((await shell("find metadata -type d | wc -l", repository)).out);
  const diskKb = Number((await shell("du -sk metadata | cut -f1", repository)).out);
  const apparentKb = Number(
    (await shell("du -sk -A metadata 2>/dev/null | cut -f1 || echo 0", repository)).out,
  );
  console.log(`[${layout}] git…`);
  const git = await measureGit(repository);
  const change = await measureChange(repository, await recordYamlFiles(repository, layout));
  const result = {
    layout,
    ...conversion,
    files,
    directories,
    diskMb: Math.round(diskKb / 1024),
    apparentMb: Math.round(apparentKb / 1024),
    ...git,
    ...change,
  };
  console.log(JSON.stringify(result));
  return result;
}

const results = [];
for (const layout of LAYOUTS) {
  results.push(await measureLayout(layout));
}
await Bun.write(out, `${JSON.stringify(results, null, 2)}\n`);
console.log("done");
