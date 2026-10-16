// Public API of the authoring context (ADR-0031, ADR-0033): built units, their comparison with
// the instance, the ledger and the decision plan makes for each unit.

export {
  type AdoptDependencies,
  type AdoptedUnit,
  type AdoptResult,
  adopt,
} from "./application/adopt";
export { readUnits } from "./application/read-units";
export {
  AdoptRecordsNotFoundError,
  AdoptStoreApplicationError,
  AdoptTransformFailedError,
  AdoptUnexplainedDifferenceError,
  InvalidRecordReferenceError,
  LedgerUncommittedError,
  NothingAdoptedError,
  SdkUnavailableError,
} from "./domain/adopt-errors";
export { compareUnit, type Difference } from "./domain/compare";
export { unitDigest } from "./domain/digest";
export { driftedUnits, type PulledRecord } from "./domain/drift";
export { SdkRouteRefusedError, UnreadableBuildError } from "./domain/errors";
export {
  EMPTY_LEDGER,
  InvalidLedgerError,
  LEDGER_FILE,
  type Ledger,
  type LedgerEntry,
  ledgerDocument,
  ledgerOf,
  withEntries,
} from "./domain/ledger";
export {
  knownLoss,
  LOSS_DESCRIPTIONS,
  LOSSES_SDK_VERSION,
  type LossId,
} from "./domain/losses";
export { planUnit, type UnitDecision } from "./domain/plan-unit";
export { sdkRouteAllowed } from "./domain/sdk-routes";
export {
  type BuiltUnit,
  type Fields,
  type InstanceCopy,
  isDeletion,
  type UnitAction,
  type UnitRecord,
} from "./domain/unit";
export {
  type ChildSpec,
  childLink,
  coalesceValues,
  type UnitSpec,
  unitSpec,
} from "./domain/unit-specs";
export { VERSION_FIELDS, versionOf } from "./domain/unit-version";
export { comparedValue, NAMED_REFERENCES, normalizeValue, sameValue } from "./domain/values";
export type {
  AuthoringWorkspace,
  BuildOutcome,
  DraftOutcome,
  FluentToolchain,
  SdkAccess,
  SourceDraft,
  SourceProject,
  TransformTarget,
} from "./ports";
