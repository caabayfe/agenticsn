// Public API of the governance context.

export {
  MAX_SCRIPT_BYTES,
  type Skipped,
  type ValidateDependencies,
  type ValidateQuery,
  type Validation,
  validate,
} from "./application/validate";
export { UnknownBaseError } from "./domain/errors";
export {
  evidenceOf,
  type Finding,
  type FindingSeverity,
  introduced,
  ordered,
} from "./domain/findings";
export type {
  ChangedRecords,
  RecordVersion,
  ScriptChecker,
  ScriptCheckResult,
  ScriptContext,
  ScriptHit,
} from "./ports";
