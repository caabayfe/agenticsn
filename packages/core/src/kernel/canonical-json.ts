// Reproduces Python's json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=True),
// which defines hash contract v1. JSON.stringify differs in three ways handled here:
// it keeps non-ASCII and DEL unescaped, and sorts keys by UTF-16 code unit.

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const SHORT_ESCAPES: ReadonlyMap<number, string> = new Map([
  [0x08, "\\b"],
  [0x09, "\\t"],
  [0x0a, "\\n"],
  [0x0c, "\\f"],
  [0x0d, "\\r"],
  [0x22, '\\"'],
  [0x5c, "\\\\"],
]);

function escapeString(text: string): string {
  const parts: string[] = ['"'];
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    const short = SHORT_ESCAPES.get(unit);
    if (short !== undefined) {
      parts.push(short);
    } else if (unit < 0x20 || unit > 0x7e) {
      parts.push(`\\u${unit.toString(16).padStart(4, "0")}`);
    } else {
      parts.push(text.charAt(index));
    }
  }
  parts.push('"');
  return parts.join("");
}

// Array.isArray does not narrow readonly arrays, so the union needs its own guard.
function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0) ?? 0);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0) ?? 0);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftPoints[index] ?? 0) - (rightPoints[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return leftPoints.length - rightPoints.length;
}

function serializeNumber(value: number): string {
  // Python and JavaScript print non-integers differently (1.0 vs 1, exponents), so the
  // canonical form only admits integers. The hash contract itself only uses strings.
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`canonical JSON only supports safe integers, got ${value}`);
  }
  return String(value);
}

export function canonicalJson(value: JsonValue): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return serializeNumber(value);
  }
  if (typeof value === "string") {
    return escapeString(value);
  }
  if (isJsonArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const members = Object.keys(value)
    .sort(compareCodePoints)
    .map((key) => `${escapeString(key)}:${canonicalJson(value[key] ?? null)}`);
  return `{${members.join(",")}}`;
}
