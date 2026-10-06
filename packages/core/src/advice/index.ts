// Public API of the advice context.

export {
  type Advice,
  type AdviseQuery,
  advise,
  DESIGN_RECORD,
  type Fit,
  type LadderStep,
  type TableFacts,
} from "./application/advise";
export { GUIDANCE, type Guidance, guidanceFor, type WorkPhase } from "./domain/guidance";
export { type Customization, INTENTS, type Intent, type Option, recognise } from "./domain/intents";
export {
  RULES,
  type Rule,
  type RuleCategory,
  ruleById,
  rulesFor,
  rulesForScript,
  type ScriptKind,
  type Severity,
} from "./domain/rules";
export { SCRIPT_FIELDS, scriptFieldsOf } from "./domain/script-fields";
