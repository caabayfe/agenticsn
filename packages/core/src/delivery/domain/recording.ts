// Whether the platform records a table's records in update sets when the Table API writes them
// (ADR-0030). The table's collection dictionary entry says so in its attributes; a table without
// the attribute takes its parent's. Pure.

export type Recording = "recorded" | "custom" | "unrecorded";

export interface TableAttributes {
  readonly name: string;
  // The table it extends, or "" at the root.
  readonly parent: string;
  // The collection entry's attributes, such as "update_synch=true,…".
  readonly attributes: string;
}

function own(attributes: string): Recording | null {
  const pairs = new Map(
    attributes.split(",").map((pair) => {
      const [key = "", value = ""] = pair.split("=");
      return [key.trim(), value.trim().toLowerCase()];
    }),
  );
  if (pairs.get("update_synch_custom") === "true") return "custom";
  const synch = pairs.get("update_synch");
  if (synch === "true") return "recorded";
  if (synch === "false") return "unrecorded";
  return null;
}

// The recording of `table`, walking up its parents; a table no ancestor says anything about is
// taken as recorded, and push's capture check reports it if it is not.
export function recordingOf(
  table: string,
  tables: ReadonlyMap<string, TableAttributes>,
): Recording {
  const seen = new Set<string>();
  let current = tables.get(table);
  while (current !== undefined && !seen.has(current.name)) {
    seen.add(current.name);
    const recording = own(current.attributes);
    if (recording !== null) return recording;
    current = tables.get(current.parent);
  }
  return "recorded";
}
