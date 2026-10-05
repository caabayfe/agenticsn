import { isScalar, type Pair, parse, Scalar, stringify } from "yaml";

// ADR-0015: sorted keys, no line wrapping, single quotes only when needed, multi-line
// values as literal blocks. Reading treats every scalar as a string (failsafe schema).

function keyOf(pair: Pair): string {
  return String(isScalar(pair.key) ? pair.key.value : pair.key);
}

function byCodePoint(left: Pair, right: Pair): number {
  const a = keyOf(left);
  const b = keyOf(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

const STYLE = {
  sortMapEntries: byCodePoint,
  lineWidth: 0,
  minContentWidth: 0,
  singleQuote: true,
  blockQuote: "literal",
  // Double-quoted values are written on one line with JSON escapes, which is always exact.
  doubleQuotedAsJSON: true,
  defaultStringType: "PLAIN",
  defaultKeyType: "PLAIN",
} as const;

export function fromYamlStrings(text: string): unknown {
  return parse(text, { schema: "failsafe" }) ?? {};
}

function roundTrips(value: string): boolean {
  return (fromYamlStrings(stringify({ v: value }, STYLE)) as { v?: unknown }).v === value;
}

// The YAML library mis-writes some multi-line values (whitespace-only first or last lines;
// found by the M2 corpus round trip). Each multi-line value is checked, and one that would
// not come back unchanged is written double-quoted instead.
function guarded(value: unknown): unknown {
  if (typeof value === "string") {
    if (!value.includes("\n") || roundTrips(value)) {
      return value;
    }
    const exact = new Scalar(value);
    exact.type = Scalar.QUOTE_DOUBLE;
    return exact;
  }
  if (Array.isArray(value)) {
    return value.map(guarded);
  }
  if (value !== null && typeof value === "object" && !(value instanceof Scalar)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, guarded(item)]));
  }
  return value;
}

export function toYaml(value: unknown): string {
  return stringify(guarded(value), STYLE);
}
