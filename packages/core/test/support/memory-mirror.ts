import type { IncrementalMirror, RenderedRecord } from "@snagentic/core";

function parts(path: string): { base: string; sysId: string } | null {
  const leafStart = path.lastIndexOf("/") + 1;
  const dot = path.indexOf(".", leafStart);
  const separator = path.lastIndexOf("--", dot);
  return dot < 0 || separator < leafStart
    ? null
    : { base: path.slice(0, dot), sysId: path.slice(separator + 2, dot) };
}

// An in-memory mirror holding one root; file contents are kept as written.
export function memoryMirror() {
  const files = new Map<string, unknown>();
  let prepared = 0;
  const mirror: IncrementalMirror = {
    write: async (_root, rendered: RenderedRecord) => {
      files.set(`${rendered.base}.yaml`, rendered.document);
      for (const file of rendered.files) {
        files.set(file.path, file.content);
      }
    },
    writeDocument: async (_root, path, document) => {
      files.set(path, document);
    },
    bases: async function* () {
      yield* new Set([...files.keys()].flatMap((path) => parts(path)?.base ?? []));
    },
    checkpoint: async () => {},
    prepare: async () => {
      prepared += 1;
    },
    finish: async () => ({ commit: "commit", created: true }),
    abort: async () => {},
    baseOf: (_root, sysId) =>
      [...files.keys()].map(parts).find((found) => found?.sysId === sysId)?.base,
    filesOf: (_root, base) => [...files.keys()].filter((path) => parts(path)?.base === base),
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
      files.delete(path);
    },
    move: async (_root, from, to) => {
      files.set(to, files.get(from));
      files.delete(from);
    },
  };
  return { mirror, files, prepared: () => prepared };
}
