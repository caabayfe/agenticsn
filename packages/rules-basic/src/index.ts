// The free rule pack: the checks behind the rules in core's advice catalog (same ids).
import type { Rule } from "eslint";
import { MANAGEABILITY_RULES } from "./rules/manageability";
import { PERFORMANCE_RULES } from "./rules/performance";
import { SECURITY_RULES } from "./rules/security";
import { UPGRADABILITY_RULES } from "./rules/upgradability";
import { USER_EXPERIENCE_RULES } from "./rules/user-experience";

export type { RecordSettings } from "./ast";

// Rule id -> its ESLint rule (script checks only; record checks live in core).
export const SCRIPT_RULES: Readonly<Record<string, Rule.RuleModule>> = {
  ...SECURITY_RULES,
  ...PERFORMANCE_RULES,
  ...UPGRADABILITY_RULES,
  ...MANAGEABILITY_RULES,
  ...USER_EXPERIENCE_RULES,
};
