// Spike S5 (throwaway): the work a post-edit hook would do for one changed file. It loads
// the ESLint Linter, adds one ServiceNow-style rule, lints the file and prints the result.
// Not product code: the real rule engine arrives in phase 2 (ADR-0006).
const started = performance.now();
const { Linter } = await import("eslint/universal");

import type { Rule } from "eslint";

const LOOPS = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
]);

const noGlideRecordInLoop: Rule.RuleModule = {
  meta: { type: "problem", messages: { inLoop: "GlideRecord created inside a loop" } },
  create(context) {
    return {
      NewExpression(node) {
        if (node.callee.type !== "Identifier" || node.callee.name !== "GlideRecord") {
          return;
        }
        if (context.sourceCode.getAncestors(node).some((ancestor) => LOOPS.has(ancestor.type))) {
          context.report({ node, messageId: "inLoop" });
        }
      },
    };
  },
};

const path = process.argv[2];
if (path === undefined) {
  console.error("usage: lint-once <file>");
  process.exit(2);
}
const source = await Bun.file(path).text();
const messages = new Linter().verify(source, [
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "script",
      globals: {
        current: "readonly",
        previous: "readonly",
        gs: "readonly",
        GlideRecord: "readonly",
      },
    },
    plugins: { sn: { rules: { "no-gliderecord-in-loop": noGlideRecordInLoop } } },
    rules: { "no-eval": "error", "sn/no-gliderecord-in-loop": "error" },
  },
]);
console.log(
  JSON.stringify({
    findings: messages.map((message) => `${message.ruleId}:${message.line}`),
    inProcessMilliseconds: performance.now() - started,
  }),
);
