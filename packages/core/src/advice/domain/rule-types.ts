import type { ScriptKind } from "./script-fields";

export type RuleCategory =
  | "security"
  | "performance"
  | "upgradability"
  | "manageability"
  | "user_experience";
export type Severity = "block" | "warn" | "info";

export interface Rule {
  readonly id: string;
  readonly category: RuleCategory;
  readonly severity: Severity;
  readonly title: string;
  readonly why: string;
  readonly remediation: string;
  readonly scripts: readonly ScriptKind[];
  // Only records of these classes; any class with matching scripts when absent.
  readonly classes?: readonly string[];
}
