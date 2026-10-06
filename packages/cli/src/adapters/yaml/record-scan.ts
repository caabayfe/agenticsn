// Reads a record file's single-line fields without a full YAML parse. Record files are
// written in our own style (ADR-0015, own-style.ts): a flat map of fields plus a `_meta`
// map, keys at fixed indentation, single-line values plain, 'single-quoted' or "JSON".
// Multi-line values (block scalars and anything else spanning lines) are skipped: indexing
// needs names, tables, timing and flags, never scripts.

export interface ScannedRecord {
  readonly meta: Readonly<Record<string, string>>;
  readonly fields: Readonly<Record<string, string>>;
}

const LINE = /^( {2})?([A-Za-z0-9_.$-]+): ?(.*)$/;

function scalar(raw: string): string | null {
  if (raw === "" || raw === "|" || raw === "|-" || raw === "|+" || raw.startsWith("|")) {
    return null;
  }
  if (raw.startsWith("'")) {
    return raw.endsWith("'") && raw.length >= 2 ? raw.slice(1, -1).replaceAll("''", "'") : null;
  }
  if (raw.startsWith('"')) {
    try {
      const value: unknown = JSON.parse(raw);
      return typeof value === "string" ? value : null;
    } catch {
      return null;
    }
  }
  return raw;
}

export function scanRecord(text: string): ScannedRecord {
  const meta: Record<string, string> = {};
  const fields: Record<string, string> = {};
  let inMeta = false;
  for (const line of text.split("\n")) {
    const match = LINE.exec(line);
    if (match === null) {
      continue;
    }
    const [, indent, key = "", raw = ""] = match;
    if (indent === undefined) {
      inMeta = key === "_meta";
    }
    const value = scalar(raw);
    if (value === null || (indent !== undefined && !inMeta)) {
      continue;
    }
    (indent === undefined ? fields : meta)[key] = value;
  }
  return { meta, fields };
}
