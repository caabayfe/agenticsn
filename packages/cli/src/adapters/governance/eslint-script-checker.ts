import type { ScriptChecker, ScriptCheckResult, ScriptContext } from "@snagentic/core";
import { SCRIPT_RULES } from "@snagentic/rules-basic";
import { Linter } from "eslint/universal";

const PLUGIN = "sn";

// Runs the basic rule pack through ESLint's in-memory linter: no files, no config lookup.
export class EslintScriptChecker implements ScriptChecker {
  private readonly linter: Linter;

  constructor() {
    this.linter = new Linter({ configType: "flat" });
  }

  check(source: string, ruleIds: readonly string[], context: ScriptContext): ScriptCheckResult {
    const rules = ruleIds.filter((id) => SCRIPT_RULES[id] !== undefined);
    const messages = this.linter.verify(source, [
      {
        plugins: { [PLUGIN]: { rules: SCRIPT_RULES } },
        rules: Object.fromEntries(rules.map((id) => [`${PLUGIN}/${id}`, "error"])),
        languageOptions: {
          ecmaVersion: "latest",
          sourceType: "script",
          // The platform wraps several script types in a function, so a top-level return is
          // valid there; failing to parse it would report working scripts as broken.
          parserOptions: { ecmaFeatures: { globalReturn: true } },
        },
        settings: {
          servicenow: {
            className: context.className,
            when: context.when,
            type: context.type,
            scoped: String(context.scoped),
            name: context.name,
          },
        },
      },
    ]);
    const fatal = messages.find((message) => message.fatal === true);
    if (fatal !== undefined) {
      return { parsed: false, line: fatal.line, message: fatal.message };
    }
    return {
      parsed: true,
      hits: messages.flatMap((message) =>
        message.ruleId === null
          ? []
          : [
              {
                ruleId: message.ruleId.slice(PLUGIN.length + 1),
                line: message.line,
                message: message.message,
              },
            ],
      ),
    };
  }
}
