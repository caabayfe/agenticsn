// The files of a mirrored tree grouped by record (ADR-0017): every file of a record starts
// with its base, <dir>/<slug>--<sys_id>, followed by a suffix such as ".yaml", ".script.js" or
// ".children.sys_ui_element.yaml". Slugs and sys_ids have no dots. Files outside records,
// such as operational inventories, are not indexed.
export class MirrorIndex {
  // Record base -> suffixes of its files.
  private readonly records = new Map<string, string[]>();
  private readonly baseBySysId = new Map<string, string>();
  // The same few suffixes repeat across hundreds of thousands of files: keep one copy each.
  private readonly suffixes = new Map<string, string>();

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
    const suffix = this.intern(parts.suffix);
    const list = this.records.get(parts.base);
    if (list === undefined) {
      this.records.set(parts.base, [suffix]);
      this.baseBySysId.set(parts.sysId, parts.base);
    } else if (!list.includes(suffix)) {
      list.push(suffix);
    }
  }

  remove(path: string): void {
    const parts = splitPath(path);
    const list = parts === null ? undefined : this.records.get(parts.base);
    if (parts === null || list === undefined) {
      return;
    }
    const remaining = list.filter((suffix) => suffix !== parts.suffix);
    if (remaining.length > 0) {
      this.records.set(parts.base, remaining);
    } else {
      this.records.delete(parts.base);
      if (this.baseBySysId.get(parts.sysId) === parts.base) {
        this.baseBySysId.delete(parts.sysId);
      }
    }
  }

  // Bases under `prefix`, relative to it.
  *bases(prefix: string): Iterable<string> {
    for (const base of this.records.keys()) {
      if (base.startsWith(prefix)) {
        yield base.slice(prefix.length);
      }
    }
  }

  baseOf(sysId: string): string | undefined {
    return this.baseBySysId.get(sysId);
  }

  // Full paths of every file of the record at `base`.
  filesOf(base: string): string[] {
    return (this.records.get(base) ?? []).map((suffix) => `${base}${suffix}`);
  }

  private intern(suffix: string): string {
    const known = this.suffixes.get(suffix);
    if (known !== undefined) {
      return known;
    }
    this.suffixes.set(suffix, suffix);
    return suffix;
  }
}

function splitPath(path: string): { base: string; suffix: string; sysId: string } | null {
  const leafStart = path.lastIndexOf("/") + 1;
  const dot = path.indexOf(".", leafStart);
  const separator = path.lastIndexOf("--", dot);
  if (dot < 0 || separator < leafStart) {
    return null;
  }
  return {
    base: path.slice(0, dot),
    suffix: path.slice(dot),
    sysId: path.slice(separator + 2, dot),
  };
}
