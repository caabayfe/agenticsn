import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import ts from "typescript";

// AGENTS.md: no `as` casts to escape the type system. Biome has no rule for it, so this reads
// product code with the compiler's parser and lists every assertion except `as const`. Data from
// outside (files, answers, the SDK) is checked with a schema instead (spec 012, step 5).
const ROOT = join(import.meta.dir, "../..");

const WIDENS = "widens a literal list so includes() takes any string; never narrows";

// Each remaining assertion: file -> asserted types, and why it is safe.
const ALLOWED: Readonly<
  Record<string, { readonly types: readonly string[]; readonly why: string }>
> = {
  "packages/core/src/kernel/scope-name.ts": {
    types: ["ScopeName"],
    why: "the validating factory is where a brand is applied",
  },
  "packages/core/src/sync/application/concurrently.ts": {
    types: ["T"],
    why: "the loop bounds the index, and T itself may include undefined",
  },
  "packages/core/src/environment/application/run-instance-checks.ts": {
    types: ["Check"],
    why: 'Row is a string record, so `"status" in` can\'t narrow Row | Check',
  },
  "packages/core/src/metadata/domain/record-layout.ts": {
    types: ["Record<string, unknown>", "Record<string, unknown>"],
    why: "parsed YAML, checked to be a mapping just before",
  },
  "packages/cli/src/adapters/fluent/built-units.ts": {
    types: ["Node[]", "Record<string, string>"],
    why: "fast-xml-parser's untyped output of the SDK's own build; tags and attributes are read defensively",
  },
  "packages/cli/src/cli/command-reference.ts": {
    types: [
      "{ properties?: Record<string, { description?: string; enum?: unknown[]; type?: string }>; required?: string[]; }",
    ],
    why: "zod's JSON Schema of our own use case inputs, for the generated reference",
  },
  "packages/rules-basic/src/rules/upgradability.ts": {
    types: ["Rule.Node"],
    why: "ESLint adds parent to every node it visits; ESTree's type doesn't declare it",
  },
  "packages/core/src/documentation/domain/features.ts": {
    types: ["readonly (string | undefined)[]"],
    why: WIDENS,
  },
  "packages/core/src/documentation/domain/page.ts": { types: ["readonly string[]"], why: WIDENS },
  "packages/core/src/documentation/domain/questions.ts": {
    types: ["readonly (string | undefined)[]"],
    why: WIDENS,
  },
  "packages/core/src/documentation/domain/references.ts": {
    types: ["readonly string[]"],
    why: WIDENS,
  },
  "packages/core/src/documentation/domain/releases.ts": {
    types: ["readonly (string | undefined)[]"],
    why: WIDENS,
  },
  "packages/core/src/documentation/domain/structure.ts": {
    types: ["readonly string[]"],
    why: WIDENS,
  },
  "packages/core/src/documentation/domain/views.ts": {
    types: ["readonly string[]"],
    why: WIDENS,
  },
};

function assertionsOf(path: string, text: string): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      const type = node.type.getText(source).replace(/\s+/g, " ");
      if (type !== "const") {
        found.push(type);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found.sort();
}

function productAssertions(): Record<string, string[]> {
  const byFile: Record<string, string[]> = {};
  for (const path of new Glob("packages/*/src/**/*.ts").scanSync(ROOT)) {
    const found = assertionsOf(path, readFileSync(join(ROOT, path), "utf8"));
    if (found.length > 0) {
      byFile[path] = found;
    }
  }
  return byFile;
}

describe("type assertions in product code", () => {
  it("are only the allowed ones, each with its reason", () => {
    const allowed = Object.fromEntries(
      Object.entries(ALLOWED).map(([path, entry]) => [path, [...entry.types].sort()]),
    );
    expect(productAssertions()).toEqual(allowed);
  });

  it("finds as and angle-bracket assertions, and ignores as const", () => {
    const text = "const a = b as Row; const c = [1] as const; const d = <Check>e;";
    expect(assertionsOf("x.ts", text)).toEqual(["Check", "Row"]);
  });
});
