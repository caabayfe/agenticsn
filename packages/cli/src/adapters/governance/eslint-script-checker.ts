import type { ScriptChecker, ScriptCheckResult, ScriptContext } from "@snagentic/core";
import { SCRIPT_RULES } from "@snagentic/rules-basic";
import { Linter, type Linter as LinterType } from "eslint/universal";

const PREFIX = "sn/";

// Runs the basic rule pack through ESLint's in-memory linter: no files, no config lookup.
export class EslintScriptChecker implements ScriptChecker {
  private readonly linter: Linter;

  constructor() {
    this.linter = new Linter({ configType: "flat" });
  }

  check(source: string, ruleIds: readonly string[], context: ScriptContext): ScriptCheckResult {
    const config = configFor(ruleIds, context);
    let messages = this.linter.verify(source, config);
    // A portal client script (controller or link) is a bare `function (...) {}` that the
    // platform evaluates as an expression. Wrapping it on the same line keeps line numbers.
    if (context.kind === "portal_client" && messages.some((m) => m.fatal === true)) {
      messages = this.linter.verify(`(${source.replace(/;\s*$/, "")}\n)`, config);
    }
    const fatal = messages.find((message) => message.fatal === true);
    if (fatal !== undefined) {
      return { parsed: false, line: fatal.line, message: fatal.message };
    }
    return {
      parsed: true,
      hits: messages.flatMap((message) =>
        message.ruleId?.startsWith(PREFIX) === true
          ? [
              {
                ruleId: message.ruleId.slice(PREFIX.length),
                line: message.line,
                message: message.message,
              },
            ]
          : [],
      ),
    };
  }
}

function configFor(ruleIds: readonly string[], context: ScriptContext): LinterType.Config[] {
  const rules = ruleIds.filter((id) => SCRIPT_RULES[id] !== undefined);
  return [
    {
      plugins: { sn: { rules: SCRIPT_RULES } },
      rules: Object.fromEntries(rules.map((id) => [`${PREFIX}${id}`, "error"])),
      // Platform scripts carry their own eslint comments (for other rules, or disabling
      // ours); they must neither change nor silence what validate reports.
      linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
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
  ];
}
