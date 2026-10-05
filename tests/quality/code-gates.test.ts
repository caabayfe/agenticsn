import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { countLines, oversizedFiles, productFileSizes } from "../../scripts/check-size";

const REPOSITORY = join(import.meta.dir, "../..");

interface Diagnostic {
  readonly category: string;
  readonly severity: string;
}

// Lints `code` as if it lived at `relativePath`, with this repository's Biome configuration,
// in an isolated copy so the repository itself is never touched.
async function lint(code: string, relativePath: string): Promise<Diagnostic[]> {
  const root = await mkdtemp(join(tmpdir(), "snagentic-gates-"));
  try {
    for (const file of ["biome.json", ".gitignore"]) {
      await Bun.write(join(root, file), Bun.file(join(REPOSITORY, file)));
    }
    await mkdir(join(root, dirname(relativePath)), { recursive: true });
    await Bun.write(join(root, relativePath), code);
    const biome = Bun.spawn(
      [join(REPOSITORY, "node_modules/.bin/biome"), "lint", "--reporter=json", "."],
      {
        cwd: root,
        stdout: "pipe",
        stderr: "ignore",
      },
    );
    const report: { diagnostics: Diagnostic[] } = JSON.parse(
      await new Response(biome.stdout).text(),
    );
    return report.diagnostics;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// A function whose body (the lines between its braces, as Biome counts) has `bodyLines` lines.
function functionWithBody(bodyLines: number): string {
  const statements = Array.from({ length: bodyLines - 2 }, (_, index) => `  total += ${index};`);
  return [
    "export function sum(): number {",
    "  let total = 0;",
    ...statements,
    "  return total;",
    "}",
    "",
  ].join("\n");
}

function deeplyBranchingFunction(): string {
  const nested = ["export function classify(values: number[]): string {", "  let label = '';"];
  nested.push("  for (const value of values) {");
  for (let depth = 0; depth < 6; depth += 1) {
    nested.push(`${"  ".repeat(depth + 2)}if (value > ${depth} && value !== ${depth + 10}) {`);
  }
  nested.push(`${"  ".repeat(8)}label += 'x';`);
  for (let depth = 5; depth >= 0; depth -= 1) {
    nested.push(`${"  ".repeat(depth + 2)}}`);
  }
  nested.push("  }", "  return label;", "}", "");
  return nested.join("\n");
}

function categories(diagnostics: Diagnostic[], severity = "error"): string[] {
  return diagnostics
    .filter((diagnostic) => diagnostic.severity === severity)
    .map((d) => d.category);
}

describe("function length gate", () => {
  it("rejects a product function whose body has 51 lines", async () => {
    const diagnostics = await lint(functionWithBody(51), "packages/core/src/long.ts");
    expect(categories(diagnostics)).toContain("lint/complexity/noExcessiveLinesPerFunction");
  });

  it("accepts a product function whose body has 50 lines", async () => {
    const diagnostics = await lint(functionWithBody(50), "packages/core/src/fits.ts");
    expect(categories(diagnostics)).not.toContain("lint/complexity/noExcessiveLinesPerFunction");
  });

  it("does not limit the length of test callbacks", async () => {
    const test = `import { it } from "bun:test";\nit("long", () => {\n${"  expect(1).toBe(1);\n".repeat(60)}});\n`;
    const diagnostics = await lint(test, "packages/core/test/long.test.ts");
    expect(categories(diagnostics)).not.toContain("lint/complexity/noExcessiveLinesPerFunction");
  });
});

describe("cognitive complexity gate", () => {
  it("rejects a function with cognitive complexity above 15", async () => {
    const diagnostics = await lint(deeplyBranchingFunction(), "packages/core/src/complex.ts");
    expect(categories(diagnostics)).toContain("lint/complexity/noExcessiveCognitiveComplexity");
  });
});

describe("file size gate", () => {
  it("counts lines like an editor: a final newline does not add a line", () => {
    expect([countLines(""), countLines("a"), countLines("a\n"), countLines("a\nb\n")]).toEqual([
      0, 1, 1, 2,
    ]);
  });

  it("reports files over the limit, largest first", () => {
    const files = [
      { path: "a.ts", lineCount: 301 },
      { path: "b.ts", lineCount: 300 },
      { path: "c.ts", lineCount: 450 },
    ];
    expect(oversizedFiles(files, 300)).toEqual([
      { path: "c.ts", lineCount: 450 },
      { path: "a.ts", lineCount: 301 },
    ]);
  });

  it("finds no product file over 300 lines in this repository", async () => {
    const sizes = await productFileSizes(REPOSITORY);
    expect(sizes.length).toBeGreaterThan(0);
    expect(oversizedFiles(sizes, 300)).toEqual([]);
  });
});
