// Public API of the governance context.

export { type CheckQuery, type CheckResult, checkFiles } from "./application/check";
export { type FluentKeysResult, writeFluentKeys } from "./application/fluent-keys";
export {
  MAX_SCRIPT_BYTES,
  type Skipped,
  type ValidateDependencies,
  type ValidateQuery,
  type Validation,
  validate,
} from "./application/validate";
export { FluentKeysUnstagedError, UnknownBaseError } from "./domain/errors";
export {
  evidenceOf,
  type Finding,
  type FindingSeverity,
  introduced,
  ordered,
} from "./domain/findings";
export {
  type FluentBuild,
  type FluentBuildError,
  type FluentProject,
  KEYS_FILE as FLUENT_KEYS_FILE,
} from "./domain/fluent-findings";
export type {
  FluentProjects,
  MirrorState,
  RecordVersion,
  ScriptChecker,
  ScriptCheckResult,
  ScriptContext,
  ScriptHit,
} from "./ports";
