import type { IncrementalMirror, RenderedRecord } from "@snagentic/core";

function parts(path: string): { base: string; sysId: string } | null {
  const leafStart = path.lastIndexOf("/") + 1;
  const dot = path.indexOf(".", leafStart);
  const separator = path.lastIndexOf("--", dot);
  return dot < 0 || separator < leafStart
    ? null
    : { base: path.slice(0, dot), sysId: path.slice(separator + 2, dot) };
}

// An in-memory mirror holding one root; file contents are kept as written. Indexed by record
// like the git mirror, so tests with thousands of records stay fast.
export function memoryMirror() {
  const files = new Map<string, unknown>();
  const byBase = new Map<string, Set<string>>();
  const baseById = new Map<string, string>();
  let prepared = 0;
  const set = (path: string, content: unknown) => {
    files.set(path, content);
    const found = parts(path);
    if (found !== null) {
      byBase.set(found.base, (byBase.get(found.base) ?? new Set()).add(path));
      baseById.set(found.sysId, found.base);
    }
  };
  const remove = (path: string) => {
    files.delete(path);
    const found = parts(path);
    const paths = found === null ? undefined : byBase.get(found.base);
    if (found === null || paths === undefined) {
      return;
    }
    paths.delete(path);
    if (paths.size === 0) {
      byBase.delete(found.base);
      if (baseById.get(found.sysId) === found.base) {
        baseById.delete(found.sysId);
      }
    }
  };
  const mirror: IncrementalMirror = {
    write: async (_root, rendered: RenderedRecord) => {
      set(`${rendered.base}.yaml`, rendered.document);
      for (const file of rendered.files) {
        set(file.path, file.content);
      }
    },
    writeDocument: async (_root, path, document) => {
      set(path, document);
    },
    bases: async function* () {
      yield* [...byBase.keys()];
    },
    checkpoint: async () => {},
    prepare: async () => {
      prepared += 1;
    },
    finish: async () => ({ commit: "commit", created: true }),
    abort: async () => {},
    baseOf: (_root, sysId) => baseById.get(sysId),
    filesOf: (_root, base) => [...(byBase.get(base) ?? [])],
    countChildRows: async (_root, table) => {
      const suffix = `.children.${table}.yaml`;
      const counts = new Map<string, number>();
      for (const [path, rows] of files) {
        if (path.endsWith(suffix) && Array.isArray(rows)) {
          counts.set(path.slice(0, -suffix.length), rows.length);
        }
      }
      return counts;
    },
    remove: async (_root, path) => {
      remove(path);
    },
    move: async (_root, from, to) => {
      const content = files.get(from);
      remove(from);
      set(to, content);
    },
  };
  return { mirror, files, prepared: () => prepared };
}
