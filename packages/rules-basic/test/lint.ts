import { Linter } from "eslint/universal";
import { SCRIPT_RULES } from "../src/index";

// Lints a script with one rule, as validate does, and returns the reported lines.
export function lint(
  ruleId: string,
  source: string,
  record: Record<string, string> = {},
): number[] {
  const rule = SCRIPT_RULES[ruleId];
  if (rule === undefined) {
    throw new Error(`no rule ${ruleId}`);
  }
  const messages = new Linter({ configType: "flat" }).verify(source, [
    {
      plugins: { sn: { rules: { [ruleId]: rule } } },
      rules: { [`sn/${ruleId}`]: "error" },
      languageOptions: { ecmaVersion: "latest", sourceType: "script" },
      settings: { servicenow: record },
    },
  ]);
  const fatal = messages.find((m) => m.fatal === true);
  if (fatal !== undefined) {
    throw new Error(`sample does not parse: ${fatal.message}`);
  }
  return messages.map((m) => m.line);
}
