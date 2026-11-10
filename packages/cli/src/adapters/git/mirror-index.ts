import { hashKey, type Key, RecordColumns, RecordTable } from "./record-columns";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let scratch = new Uint8Array(1024);

// UTF-8 bytes of `text` in a shared buffer, valid until the next call: lookups allocate nothing.
function utf8(text: string): Key {
  if (text.length * 3 > scratch.length) {
    scratch = new Uint8Array(text.length * 3);
  }
  return { bytes: scratch, length: encoder.encodeInto(text, scratch).written };
}

// The files of a mirrored tree grouped by record (ADR-0017): every file of a record starts
// with its base, <dir>/<slug>--<sys_id>, followed by a suffix such as ".yaml", ".script.js" or
// ".children.sys_ui_element.yaml". Slugs and sys_ids have no dots. Files outside records,
// such as operational inventories, are not indexed.
//
// Directories and suffix lists are stored once, and each record is its leaf name's bytes and
// a few numbers (record-columns.ts), so large mirrors fit in a fraction of the memory a Map
// entry per base and per sys_id took (PERF-07).
export class MirrorIndex {
  private readonly records = new RecordColumns();
  // Directories with their trailing slash ("" for the top of the tree).
  private readonly dirs: string[] = [];
  private readonly dirIds = new Map<string, number>();
  // Suffix lists in the order their files were added; list 0 is a removed record's.
  private readonly lists: string[][] = [[]];
  private readonly listIds = new Map<string, number>([["", 0]]);
  private readonly byBase = new RecordTable((record) => this.records.baseHashOf(record));
  private readonly bySysId = new RecordTable((record) => this.records.idHashOf(record));

  static fromPaths(paths: Iterable<string>): MirrorIndex {
    const index = new MirrorIndex();
    for (const path of paths) {
      index.add(path);
    }
    return index;
  }

  add(path: string): void {
    const parts = splitPath(path);
    if (parts === null) {
      return;
    }
    const dirId = this.internDir(parts.dir);
    const leaf = utf8(parts.leaf);
    const record = this.findBase(dirId, leaf);
    if (record >= 0) {
      const list = this.lists[this.records.listOf(record)] ?? [];
      if (!list.includes(parts.suffix)) {
        this.records.setList(record, this.listId([...list, parts.suffix]));
      }
      return;
    }
    const sysId = utf8(parts.sysId);
    const id = { length: sysId.length, hash: hashKey(sysId, 0) };
    const listId = this.listId([parts.suffix]);
    const created = this.records.push(dirId, utf8(parts.leaf), id, listId);
    this.byBase.insert(this.records.baseHashOf(created), created);
    // The newest record with a sys_id is the one found by it.
    this.bySysId.set(id.hash, created, (other) => this.records.sameSysId(other, created));
  }

  remove(path: string): void {
    const parts = splitPath(path);
    const dirId = parts === null ? undefined : this.dirIds.get(parts.dir);
    if (parts === null || dirId === undefined) {
      return;
    }
    const record = this.findBase(dirId, utf8(parts.leaf));
    if (record < 0) {
      return;
    }
    const remaining = (this.lists[this.records.listOf(record)] ?? []).filter(
      (suffix) => suffix !== parts.suffix,
    );
    this.records.setList(record, this.listId(remaining));
    if (remaining.length === 0) {
      this.byBase.delete(this.records.baseHashOf(record), (other) => other === record);
      this.bySysId.delete(this.records.idHashOf(record), (other) => other === record);
    }
  }

  // Bases under `prefix`, relative to it.
  *bases(prefix: string): Iterable<string> {
    // Per directory: every base in it matches, none does, or each must be checked.
    const scope = this.dirs.map((dir) => {
      if (dir.startsWith(prefix)) return "all";
      return prefix.startsWith(dir) ? "check" : "none";
    });
    for (let record = 0; record < this.records.count; record += 1) {
      const match = scope[this.records.dirOf(record)];
      if (this.records.listOf(record) === 0 || match === "none") {
        continue;
      }
      const base = this.baseOfRecord(record);
      if (match === "all" || base.startsWith(prefix)) {
        yield base.slice(prefix.length);
      }
    }
  }

  baseOf(sysId: string): string | undefined {
    const bytes = utf8(sysId);
    const record = this.bySysId.find(hashKey(bytes, 0), (other) =>
      this.records.sysIdIs(other, bytes),
    );
    return record < 0 ? undefined : this.baseOfRecord(record);
  }

  // Full paths of every file of the record at `base`.
  filesOf(base: string): string[] {
    const leafStart = base.lastIndexOf("/") + 1;
    const dirId = this.dirIds.get(base.slice(0, leafStart));
    const leaf = utf8(base.slice(leafStart));
    const record = dirId === undefined ? -1 : this.findBase(dirId, leaf);
    const list = record < 0 ? [] : (this.lists[this.records.listOf(record)] ?? []);
    return list.map((suffix) => `${base}${suffix}`);
  }

  private baseOfRecord(record: number): string {
    const dir = this.dirs[this.records.dirOf(record)] ?? "";
    return `${dir}${decoder.decode(this.records.leaf(record))}`;
  }

  private findBase(dirId: number, leaf: Key): number {
    return this.byBase.find(
      hashKey(leaf, dirId),
      (record) => this.records.dirOf(record) === dirId && this.records.leafIs(record, leaf),
    );
  }

  private internDir(dir: string): number {
    const known = this.dirIds.get(dir);
    if (known !== undefined) {
      return known;
    }
    this.dirs.push(dir);
    this.dirIds.set(dir, this.dirs.length - 1);
    return this.dirs.length - 1;
  }

  private listId(list: readonly string[]): number {
    const key = list.join("\0");
    const known = this.listIds.get(key);
    if (known !== undefined) {
      return known;
    }
    this.lists.push([...list]);
    this.listIds.set(key, this.lists.length - 1);
    return this.lists.length - 1;
  }
}

function splitPath(
  path: string,
): { dir: string; leaf: string; suffix: string; sysId: string } | null {
  const leafStart = path.lastIndexOf("/") + 1;
  const dot = path.indexOf(".", leafStart);
  const separator = path.lastIndexOf("--", dot);
  if (dot < 0 || separator < leafStart) {
    return null;
  }
  return {
    dir: path.slice(0, leafStart),
    leaf: path.slice(leafStart, dot),
    suffix: path.slice(dot),
    sysId: path.slice(separator + 2, dot),
  };
}
