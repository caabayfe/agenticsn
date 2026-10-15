// The IDs a build added to a Fluent project's keys.ts (P5, spec 005). Pure. keys.ts names each
// record as `<id>: {` followed by its `table:` line, in the SDK's own layout.
const ENTRY = /^\s*([A-Za-z0-9_$]+|'[^']+'|"[^"]+"): \{\s*\n\s*table:/gm;

const ids = (text: string | null): Set<string> =>
  new Set([...(text ?? "").matchAll(ENTRY)].map((m) => (m[1] ?? "").replace(/^['"]|['"]$/g, "")));

export function addedKeys(committed: string | null, built: string): string[] {
  const before = ids(committed);
  return [...ids(built)].filter((id) => !before.has(id)).sort();
}
