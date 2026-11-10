import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SKILLS } from "../../packages/agent-packs/src/index";
import { USE_CASES } from "../../packages/cli/src/registry/registry";
import { mcpToolName } from "../../packages/cli/src/registry/use-case";
import { RULES } from "../../packages/core/src/index";

// The counts the product documents quote, taken from code so they can't go stale again.
const ROOT = join(import.meta.dir, "../..");
const DOCS = [
  "README.md",
  "docs/getting-started.md",
  "docs/product/overview.md",
  "docs/product/security-and-governance.md",
];
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

const counts = (text: string, noun: string): number[] =>
  [...text.matchAll(new RegExp(`\\b(\\d+|${WORDS.join("|")}) ${noun}\\b`, "g"))].map((m) => {
    const value = m[1] ?? "";
    return WORDS.includes(value) ? WORDS.indexOf(value) : Number(value);
  });

describe("product documents (spec 014, F9)", () => {
  const tools = new Set(USE_CASES.filter((useCase) => useCase.mcp).map(mcpToolName)).size;

  for (const doc of DOCS) {
    const text = readFileSync(join(ROOT, doc), "utf8");

    it(`${doc} quotes the rule, MCP tool and skill counts the code has`, () => {
      for (const n of counts(text, "(?:platform )?rules")) {
        expect(n).toBe(RULES.length);
      }
      for (const n of counts(text, "tools")) {
        expect(n).toBe(tools);
      }
      for (const n of counts(text, "workflow skills")) {
        expect(n).toBe(SKILLS.length);
      }
    });
  }

  it("quotes each count at least once", () => {
    const all = DOCS.map((doc) => readFileSync(join(ROOT, doc), "utf8")).join("\n");
    expect(counts(all, "(?:platform )?rules")).toContain(RULES.length);
    expect(counts(all, "tools")).toContain(tools);
    expect(counts(all, "workflow skills")).toContain(SKILLS.length);
  });
});
