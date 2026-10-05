import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { RecordStore, RenderedRecord, StoredRecord } from "@snagentic/core";
import { fromYamlStrings, toYaml } from "../yaml/own-style";
import { groupRecordFiles, type RecordFiles } from "./record-files";

const READ_CONCURRENCY = 32;

async function* directories(root: string): AsyncGenerator<string> {
  yield root;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      yield* directories(join(root, entry.name));
    }
  }
}

// Writes are not atomic on purpose: a full pull writes hundreds of thousands of files, and
// a torn write is detected by the hash stored in every record (ADR-0017).
export class FlatRecordStore implements RecordStore {
  async write(
    root: string,
    rendered: RenderedRecord,
    previousPaths: readonly string[] = [],
  ): Promise<void> {
    const yamlPath = join(root, `${rendered.base}.yaml`);
    await mkdir(dirname(yamlPath), { recursive: true });
    const current = new Set(rendered.files.map((file) => file.path));
    await Promise.all([
      writeFile(yamlPath, toYaml(rendered.document)),
      ...rendered.files.map((file) => writeFile(join(root, file.path), file.content)),
      ...previousPaths
        .filter((path) => !current.has(path))
        .map((path) => rm(join(root, path), { force: true })),
    ]);
  }

  async writeDocument(root: string, path: string, document: unknown): Promise<void> {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, toYaml(document));
  }

  async *bases(root: string): AsyncIterable<string> {
    if (!existsSync(root)) {
      return;
    }
    for await (const directory of directories(root)) {
      const names = (await readdir(directory, { withFileTypes: true }))
        .filter((e) => e.isFile())
        .map((e) => e.name);
      const relative = directory === root ? "" : `${directory.slice(root.length + 1)}/`;
      for (const leaf of groupRecordFiles(names).keys()) {
        yield `${relative}${leaf}`;
      }
    }
  }

  async remove(root: string, base: string): Promise<void> {
    const directory = dirname(join(root, base));
    const prefix = `${basename(base)}.`;
    const names = await readdir(directory).catch(() => [] as string[]);
    await Promise.all(
      names
        .filter((name) => name.startsWith(prefix))
        .map((name) => rm(join(directory, name), { force: true })),
    );
  }

  async read(root: string, base: string): Promise<StoredRecord | null> {
    const directory = dirname(join(root, base));
    if (!existsSync(join(root, `${base}.yaml`))) {
      return null;
    }
    const group = groupRecordFiles(await readdir(directory)).get(basename(base));
    return group === undefined ? null : this.load(directory, dirname(base), group);
  }

  async *list(root: string): AsyncIterable<StoredRecord> {
    if (!existsSync(root)) {
      return;
    }
    for await (const directory of directories(root)) {
      const names = (await readdir(directory, { withFileTypes: true }))
        .filter((e) => e.isFile())
        .map((e) => e.name);
      const relative = directory === root ? "." : directory.slice(root.length + 1);
      const groups = [...groupRecordFiles(names).values()];
      for (let index = 0; index < groups.length; index += READ_CONCURRENCY) {
        const batch = groups.slice(index, index + READ_CONCURRENCY);
        yield* await Promise.all(batch.map((group) => this.load(directory, relative, group)));
      }
    }
  }

  private async load(
    directory: string,
    relative: string,
    group: RecordFiles,
  ): Promise<StoredRecord> {
    const text = (name: string) => readFile(join(directory, name), "utf8");
    const [yaml, files, children] = await Promise.all([
      text(group.yaml),
      Promise.all(
        group.files.map(async (file) => ({ field: file.field, content: await text(file.name) })),
      ),
      Promise.all(
        group.children.map(async (child) => ({
          table: child.table,
          content: await text(child.name),
        })),
      ),
    ]);
    const base = relative === "." ? group.leaf : `${relative}/${group.leaf}`;
    return { base, document: fromYamlStrings(yaml), files, children };
  }
}
