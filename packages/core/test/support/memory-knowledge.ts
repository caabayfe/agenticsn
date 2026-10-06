import type {
  CodeHit,
  IndexedRecord,
  IndexMarker,
  KnowledgeStore,
  MirrorFiles,
  RecordFields,
} from "@snagentic/core";

export function memoryStore(): KnowledgeStore & { readonly records: Map<string, IndexedRecord> } {
  const records = new Map<string, IndexedRecord>();
  let current: IndexMarker | null = null;
  return {
    records,
    marker: async () => current,
    apply: async (upserts, removed, marker) => {
      for (const base of removed) records.delete(base);
      for (const record of upserts) records.set(record.base, record);
      current = marker ?? current;
    },
    search: async (query) => {
      const needle = query.text?.toLowerCase() ?? "";
      const found = [...records.values()].filter(
        (r) =>
          (needle === "" ||
            `${r.name} ${r.className} ${r.table ?? ""}`.toLowerCase().includes(needle)) &&
          (query.className === undefined || r.className === query.className) &&
          (query.scope === undefined || r.scope === query.scope) &&
          (query.table === undefined || r.table === query.table),
      );
      return { records: found.slice(0, query.limit), total: found.length };
    },
    onTables: async (tables) =>
      [...records.values()].filter((r) => r.table !== null && tables.includes(r.table)),
    byBases: async (bases) => bases.flatMap((base) => records.get(base) ?? []),
    bySysId: async (sysId) => [...records.values()].find((r) => r.sysId === sysId) ?? null,
    count: async () => records.size,
  };
}

// Files of a workspace: committed content per commit, plus local edits on top.
export function memoryMirror(files: Record<string, RecordFields>) {
  const state = {
    head: "c1" as string | null,
    files: { ...files },
    committedSince: new Map<string, string[]>(),
    dirty: [] as string[],
    code: [] as CodeHit[],
    beside: {} as Record<string, string[]>,
  };
  const mirror: MirrorFiles = {
    head: async () => state.head,
    changes: async (commit) => ({
      committed:
        commit === null ? Object.keys(state.files) : (state.committedSince.get(commit) ?? []),
      dirty: [...state.dirty],
    }),
    readRecord: async (path) => state.files[path] ?? null,
    filesOf: async (base) => state.beside[base] ?? [],
    grep: async (text, limit) =>
      state.code.filter((hit) => hit.text.includes(text)).slice(0, limit),
  };
  return { mirror, state };
}

export const record = (
  className: string,
  sysId: string,
  fields: Record<string, string>,
): RecordFields => ({
  meta: {
    sys_class_name: className,
    sys_id: sysId,
    scope: "global",
    sys_updated_on: "2026-10-01 10:00:00",
  },
  fields,
});
