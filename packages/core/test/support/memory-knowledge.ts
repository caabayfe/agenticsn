import type {
  CodeHit,
  IndexedRecord,
  IndexMarker,
  KnowledgeStore,
  MirrorFiles,
  RecordFields,
} from "@snagentic/core";

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean);

// True when `phrase`'s words appear in `text`'s words in sequence (as FTS5 phrases do).
function hasPhrase(text: string, phrase: string): boolean {
  const wanted = words(phrase);
  return wanted.length > 0 && ` ${words(text).join(" ")} `.includes(` ${wanted.join(" ")} `);
}

export function memoryStore(): KnowledgeStore & { readonly records: Map<string, IndexedRecord> } {
  const records = new Map<string, IndexedRecord>();
  const texts = new Map<string, string>();
  let current: IndexMarker | null = null;
  return {
    records,
    marker: async () => current,
    apply: async (upserts, removed, marker) => {
      for (const base of removed) {
        records.delete(base);
        texts.delete(base);
      }
      for (const { record, text } of upserts) {
        records.set(record.base, record);
        texts.set(record.base, text);
      }
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
    containing: async (phrases, limit) =>
      [...texts]
        .filter(([, text]) => phrases.some((phrase) => hasPhrase(text, phrase)))
        .map(([base]) => base)
        .slice(0, limit),
    count: async () => records.size,
  };
}

// Files of a workspace: committed content per commit, plus local edits on top. A record's
// text is its fields and the code lines of its files.
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
    readDocument: async (base) => {
      const record = state.files[`${base}.yaml`] ?? null;
      const code = state.code
        .filter((hit) => hit.path.startsWith(`${base}.`))
        .map((hit) => hit.text);
      return {
        record,
        text:
          record === null
            ? ""
            : [...Object.values(record.fields), record.meta["sys_id"] ?? "", ...code].join("\n"),
      };
    },
    filesOf: async (base) => state.beside[base] ?? [],
    grep: async (texts, options) =>
      state.code
        .filter(
          (hit) =>
            options.bases === undefined ||
            options.bases.some((base) => hit.path.startsWith(`${base}.`)),
        )
        .filter((hit) =>
          texts.some((text) =>
            options.wholeWords === true
              ? new RegExp(`(^|[^A-Za-z0-9_])${text}([^A-Za-z0-9_]|$)`).test(hit.text)
              : hit.text.includes(text),
          ),
        )
        .slice(0, options.limit),
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
