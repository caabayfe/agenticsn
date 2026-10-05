import type { Brand } from "./brand";
import { slug } from "./slug";

export type ScopeName = Brand<string, "ScopeName">;

const SAFE_SEGMENT = /^[A-Za-z0-9_.$-]+$/;
// Python's str.strip() whitespace set, so scope folders match v1 exactly. It differs from
// String.prototype.trim(): it includes \x1c-\x1f and \x85, and excludes ﻿.
const PYTHON_WHITESPACE =
  "\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const SURROUNDING_WHITESPACE = new RegExp(`^[${PYTHON_WHITESPACE}]+|[${PYTHON_WHITESPACE}]+$`, "g");

function brandScope(value: string): ScopeName {
  return value as ScopeName;
}

export const ScopeName = {
  // Instance data can contain stray whitespace or symbols: normalize, never fail.
  fromInstance(value: string | null): ScopeName {
    const trimmed = (value ?? "").replace(SURROUNDING_WHITESPACE, "");
    if (trimmed === "") {
      return brandScope("global");
    }
    if (SAFE_SEGMENT.test(trimmed) && trimmed !== "." && trimmed !== "..") {
      return brandScope(trimmed);
    }
    return brandScope(slug(trimmed));
  },
};
